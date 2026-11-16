import { getDb } from "./db/client";
import { ingestEvents } from "./events/ingest";
import { publish } from "./events/bus";
import { runAlertEngine } from "./alerts/engine";
import { getRegistry } from "./registry/registry";
import { importHistory, reattributeRuns } from "./claude-tasks/history";
import { readSettings } from "./settings";

/** Ingest + alert evaluation + live notifications. Used by the HTTP API. */
export function handleIncomingEvents(body: unknown) {
  const db = getDb();
  const result = ingestEvents(db, body);
  if (result.accepted > 0) {
    const reg = getRegistry();
    // A hook session that turns out to be a scheduled task's run is moved to that task's agent.
    const firstTurns = result.touched.filter((t) => t.eventType === "message" || t.eventType === "run_started").map((t) => t.runId);
    if (firstTurns.length && reattributeRuns(db, reg, firstTurns) > 0) {
      for (const t of result.touched) {
        const row = db.$client.prepare(`SELECT agent_id FROM runs WHERE id = ?`).get(t.runId) as { agent_id: string } | undefined;
        if (row) t.agentId = row.agent_id;
      }
    }
    const touchedAgents = new Set(result.touched.map((t) => t.agentId));
    const manifests = reg.agents.filter((m) => touchedAgents.has(m.id));
    const changes = runAlertEngine(db, manifests);
    for (const t of result.touched.slice(-20)) publish({ kind: "event", ...t });
    for (const c of changes) publish({ kind: "alert", agentId: c.agentId, status: c.change });
  }
  return result;
}

/** Periodic sweep for time-based rules (no_run_within, runtime_exceeds). */
export function sweepAlerts() {
  const changes = runAlertEngine(getDb(), getRegistry().agents, Date.now(), { fullRegistry: true });
  for (const c of changes) publish({ kind: "alert", agentId: c.agentId, status: c.change });
  return changes;
}

/** Background: pull in Claude Code session history (scheduled-task runs etc.). */
export function syncHistory(opts: { force?: boolean } = {}) {
  if (!opts.force && !readSettings().autoImportHistory) return null;
  const res = importHistory(getDb(), getRegistry());
  if (res.imported || res.reattributed) {
    sweepAlerts();
    publish({ kind: "registry" });
  }
  return res;
}
