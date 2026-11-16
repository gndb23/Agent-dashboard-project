/**
 * Backfill run history from local Claude Code transcripts.
 *
 *   npm run import:transcripts                       # all of ~/.claude/projects
 *   npm run import:transcripts -- --since 7          # only files modified in the last 7 days
 *   npm run import:transcripts -- --project my-repo  # only projects whose folder contains "my-repo"
 *   npm run import:transcripts -- --agent my-agent   # force the agent id
 *   npm run import:transcripts -- --dir /path/to/projects
 *
 * Idempotent: every event gets a deterministic event_id, so re-running only adds new activity.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, dbPath } from "../src/lib/db/client";
import { ingestEvents } from "../src/lib/events/ingest";
import { transcriptCwd, transcriptToEvents } from "../src/lib/importer";
import { findAgentFile } from "../integrations/claude-code/hook.mjs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const root = arg("dir") ?? path.join(os.homedir(), ".claude", "projects");
const sinceDays = arg("since") ? Number(arg("since")) : undefined;
const project = arg("project");
const agentId = arg("agent");

function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}

if (!fs.existsSync(root)) {
  console.error(`No transcripts found at ${root}`);
  process.exit(1);
}

const db = createDb(dbPath());
const cutoff = sinceDays ? Date.now() - sinceDays * 86_400_000 : 0;
let files = 0, accepted = 0, duplicates = 0, rejected = 0, skippedLive = 0;
// Sessions already captured live by the hook are skipped to avoid double counting.
const capturedLive = db.$client.prepare(
  `SELECT 1 FROM events WHERE run_id = ? AND json_extract(payload,'$._source') = 'claude-code-hook' LIMIT 1`,
);

for (const file of walk(root)) {
  if (project && !file.includes(project)) continue;
  if (cutoff && fs.statSync(file).mtimeMs < cutoff) continue;
  const text = fs.readFileSync(file, "utf8");
  // Same rule as the live hook: --agent, else .claude/agent-ops.json in the session's folder, else the folder name.
  const cwd = transcriptCwd(text);
  const events = transcriptToEvents(text, { fileName: file, agentId: agentId ?? (cwd ? findAgentFile(cwd)?.agent_id : undefined) });
  if (events.length === 0) continue;
  if (capturedLive.get(events[0].run_id)) {
    skippedLive++;
    continue;
  }
  files++;
  for (let i = 0; i < events.length; i += 500) {
    const r = ingestEvents(db, events.slice(i, i + 500));
    accepted += r.accepted;
    duplicates += r.duplicates;
    rejected += r.rejected.length;
    for (const x of r.rejected.slice(0, 3)) console.warn(`  ! ${path.basename(file)} #${x.index}: ${x.error.split("\n")[0]}`);
  }
}

console.log(`Imported ${files} transcript(s) from ${root}`);
console.log(`  events: ${accepted} new, ${duplicates} already imported, ${rejected} rejected`);
if (skippedLive) console.log(`  skipped ${skippedLive} session(s) already captured live by the hook`);
console.log(`  database: ${dbPath()}`);
console.log(`Tip: sessions are named after .claude/agent-ops.json (from npm run register) or the project folder.`);
