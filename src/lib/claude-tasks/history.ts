/**
 * Background import of Claude Code session history (~/.claude/projects/**.jsonl).
 * This is how runs of Claude Desktop scheduled tasks show up even without hooks.
 * Incremental (only changed files), idempotent (deterministic event ids), and it never
 * imports sessions the dashboard itself started (chat, Ask, Run now) or the hook already captured.
 */
import fs from "node:fs";
import path from "node:path";
import type { DB } from "../db/client";
import type { Registry } from "../registry/registry";
import { ingestEvents } from "../events/ingest";
import { transcriptCwd, transcriptFirstPrompt, transcriptToEvents } from "../importer";
import { attributeSession } from "./attribute";
import { claudeConfigDir } from "./discover";
// Same agent-label rule as the live hook (.claude/agent-ops.json written by `npm run register`).
import { findAgentFile } from "../../../integrations/claude-code/hook.mjs";

export type HistoryResult = { files: number; imported: number; events: number; skipped: number; reattributed: number; errors: string[] };

function ensureState(db: DB) {
  db.$client.exec(`CREATE TABLE IF NOT EXISTS import_state (file TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL)`);
}

function* walk(dir: string, depth = 0): Generator<string> {
  if (depth > 4) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}

/** Session ids the dashboard started itself (chat, Ask, Run now): those aren't agent runs to import. */
function dashboardSessions(db: DB): Set<string> {
  const ids = new Set<string>();
  for (const r of db.$client.prepare(`SELECT DISTINCT session_id s FROM chat_messages WHERE session_id IS NOT NULL`).all() as { s: string }[]) ids.add(r.s);
  for (const r of db.$client
    .prepare(`SELECT DISTINCT run_id s FROM events WHERE json_extract(payload,'$._source') IN ('dashboard-run','sample-script','seed')`)
    .all() as { s: string }[])
    ids.add(r.s);
  return ids;
}

export function resolveAgentFor(reg: Registry, cwd?: string, prompt?: string): string | undefined {
  const fromFile = cwd ? (findAgentFile(cwd)?.agent_id as string | undefined) : undefined;
  return fromFile ?? attributeSession(reg, { cwd, prompt }) ?? undefined;
}

/** Moves a run (and its events) to another agent. Used when a session turns out to be a scheduled task's run. */
export function moveRun(db: DB, runId: string, agentId: string) {
  const tx = db.$client.transaction(() => {
    db.$client.prepare(`UPDATE runs SET agent_id = ? WHERE id = ?`).run(agentId, runId);
    db.$client.prepare(`UPDATE events SET agent_id = ? WHERE run_id = ?`).run(agentId, runId);
  });
  tx();
}

export function importHistory(
  db: DB,
  reg: Registry,
  opts: { root?: string; maxAgeDays?: number; now?: number } = {},
): HistoryResult {
  ensureState(db);
  const root = opts.root ?? path.join(claudeConfigDir(), "projects");
  const now = opts.now ?? Date.now();
  const cutoff = now - (opts.maxAgeDays ?? 30) * 86_400_000;
  const res: HistoryResult = { files: 0, imported: 0, events: 0, skipped: 0, reattributed: 0, errors: [] };
  if (!fs.existsSync(root)) return res;

  const getState = db.$client.prepare(`SELECT mtime, size FROM import_state WHERE file = ?`);
  const setState = db.$client.prepare(`INSERT INTO import_state (file, mtime, size) VALUES (?, ?, ?) ON CONFLICT(file) DO UPDATE SET mtime = excluded.mtime, size = excluded.size`);
  const hookCaptured = db.$client.prepare(`SELECT agent_id FROM runs WHERE id = ? AND EXISTS (SELECT 1 FROM events WHERE run_id = runs.id AND json_extract(payload,'$._source') = 'claude-code-hook')`);
  const ours = dashboardSessions(db);

  for (const file of walk(root)) {
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (st.mtimeMs < cutoff) continue;
    res.files++;
    const prev = getState.get(file) as { mtime: number; size: number } | undefined;
    if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) continue;
    try {
      const text = fs.readFileSync(file, "utf8");
      const cwd = transcriptCwd(text);
      const prompt = transcriptFirstPrompt(text);
      const agentId = resolveAgentFor(reg, cwd, prompt);
      const events = transcriptToEvents(text, { fileName: file, agentId });
      const runId = events[0]?.run_id;
      if (!runId || ours.has(runId)) {
        res.skipped++;
      } else {
        const captured = hookCaptured.get(runId) as { agent_id: string } | undefined;
        if (captured) {
          // Live hook already recorded it; just make sure it's filed under the right agent.
          if (agentId && captured.agent_id !== agentId && !reg.byId.has(captured.agent_id)) {
            moveRun(db, runId, agentId);
            res.reattributed++;
          }
          res.skipped++;
        } else {
          for (let i = 0; i < events.length; i += 500) {
            const r = ingestEvents(db, events.slice(i, i + 500));
            res.events += r.accepted;
          }
          res.imported++;
        }
      }
      setState.run(file, st.mtimeMs, st.size);
    } catch (e) {
      res.errors.push(`${path.basename(file)}: ${(e as Error).message}`);
    }
  }
  return res;
}

/**
 * Live runs from the hook start under the folder name; once the first prompt arrives we can
 * tell whether the session is a scheduled task's run and move it to that agent.
 */
export function reattributeRuns(db: DB, reg: Registry, runIds: string[]): number {
  let moved = 0;
  const runStmt = db.$client.prepare(`SELECT agent_id FROM runs WHERE id = ?`);
  const cwdStmt = db.$client.prepare(`SELECT json_extract(payload,'$.cwd') cwd FROM events WHERE run_id = ? AND event_type = 'run_started' ORDER BY id LIMIT 1`);
  const promptStmt = db.$client.prepare(`SELECT json_extract(payload,'$.text') t FROM events WHERE run_id = ? AND event_type = 'message' ORDER BY id LIMIT 1`);
  for (const id of new Set(runIds)) {
    const run = runStmt.get(id) as { agent_id: string } | undefined;
    if (!run || reg.byId.has(run.agent_id)) continue;
    const cwd = (cwdStmt.get(id) as { cwd: string | null } | undefined)?.cwd ?? undefined;
    const prompt = (promptStmt.get(id) as { t: string | null } | undefined)?.t ?? undefined;
    const agentId = attributeSession(reg, { cwd: cwd ?? undefined, prompt: prompt ?? undefined });
    if (agentId && agentId !== run.agent_id) {
      moveRun(db, id, agentId);
      moved++;
    }
  }
  return moved;
}
