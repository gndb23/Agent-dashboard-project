import { getDb } from "./db/client";
import { ingestEvents } from "./events/ingest";
import { publish } from "./events/bus";
import { runAlertEngine } from "./alerts/engine";
import { getRegistry } from "./registry/registry";

/** Ingest + alert evaluation + live notifications. Used by the HTTP API. */
export function handleIncomingEvents(body: unknown) {
  const db = getDb();
  const result = ingestEvents(db, body);
  if (result.accepted > 0) {
    const touchedAgents = new Set(result.touched.map((t) => t.agentId));
    const manifests = getRegistry().agents.filter((m) => touchedAgents.has(m.id));
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
