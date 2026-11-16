/**
 * Optional built-in scheduler: runs agents whose manifest has `run: { on_schedule: true }`
 * on their cron, while the dashboard is running. Claude Desktop tasks are never run here
 * (the Claude app already runs them on schedule).
 */
import { CronExpressionParser } from "cron-parser";
import { getDb } from "../db/client";
import { getRegistry } from "../registry/registry";
import { isAgentRunning, startAgentRun } from "./run-agent";

const WINDOW_MS = 5 * 60_000;

/** The most recent scheduled time at or before `now`. */
export function previousFire(cron: string, tz: string | undefined, now: Date): Date | null {
  try {
    return CronExpressionParser.parse(cron, { currentDate: new Date(now.getTime() + 1000), tz }).prev().toDate();
  } catch {
    return null;
  }
}

/** Decides whether an agent is due: a fire time passed recently and wasn't handled yet. */
export function isDue(prev: Date | null, lastHandled: number | undefined, now: Date): boolean {
  if (!prev) return false;
  if (lastHandled !== undefined && prev.getTime() <= lastHandled) return false;
  return now.getTime() - prev.getTime() <= WINDOW_MS;
}

export function tick(now = new Date()) {
  const db = getDb();
  db.$client.exec(`CREATE TABLE IF NOT EXISTS scheduler_state (agent_id TEXT PRIMARY KEY, last_fire INTEGER NOT NULL)`);
  const get = db.$client.prepare(`SELECT last_fire FROM scheduler_state WHERE agent_id = ?`);
  const set = db.$client.prepare(`INSERT INTO scheduler_state (agent_id, last_fire) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET last_fire = excluded.last_fire`);
  const started: string[] = [];
  for (const m of getRegistry().agents) {
    if (!m.run?.on_schedule || !m.schedule || m.origin) continue;
    const prev = previousFire(m.schedule, m.timezone, now);
    const row = get.get(m.id) as { last_fire: number } | undefined;
    if (!row) {
      // First time we see this agent: start from now, don't run missed times.
      if (prev) set.run(m.id, prev.getTime());
      continue;
    }
    if (!isDue(prev, row.last_fire, now) || isAgentRunning(m.id)) continue;
    set.run(m.id, prev!.getTime());
    const r = startAgentRun(m, "schedule");
    if ("runId" in r) started.push(m.id);
  }
  return started;
}

export function startScheduler() {
  const g = globalThis as unknown as { __agentOpsScheduler?: boolean };
  if (g.__agentOpsScheduler) return;
  g.__agentOpsScheduler = true;
  setInterval(() => {
    try {
      tick();
    } catch (e) {
      console.error("[agent-ops] scheduler tick failed", e);
    }
  }, 30_000).unref();
}
