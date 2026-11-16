import type { DB } from "../db/client";
import type { AgentManifest } from "../registry/manifest";
import { evaluateRules, type RunSummary } from "./rules";

export type EngineChange = { agentId: string; ruleKey: string; change: "opened" | "resolved" | "updated" };

const RECENT_RUNS = 200;

/**
 * Reconciles stored alerts with the current rule violations:
 * - new violation        → open alert
 * - existing violation   → refresh message (keeps acknowledged state)
 * - violation cleared    → resolve open/acknowledged alert
 * Alerts for rules removed from a manifest are resolved too; with `fullRegistry`,
 * alerts of agents whose manifest was deleted are resolved as well.
 */
export function runAlertEngine(
  db: DB,
  manifests: AgentManifest[],
  now = Date.now(),
  opts: { fullRegistry?: boolean } = {},
): EngineChange[] {
  const sqlite = db.$client;
  const changes: EngineChange[] = [];
  const recentRuns = sqlite.prepare(
    `SELECT id, status, started_at AS startedAt, ended_at AS endedAt, cost_usd AS costUsd
     FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ${RECENT_RUNS}`,
  );
  const activeAlerts = sqlite.prepare(
    `SELECT id, rule_key AS ruleKey, message FROM alerts WHERE agent_id = ? AND status IN ('open','acknowledged')`,
  );
  const insert = sqlite.prepare(
    `INSERT INTO alerts (agent_id, rule_key, rule_type, severity, message, status, run_id, triggered_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
  );
  const update = sqlite.prepare(`UPDATE alerts SET message = ?, run_id = COALESCE(?, run_id), severity = ? WHERE id = ?`);
  const resolve = sqlite.prepare(`UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE id = ?`);
  const resolveOrphans = sqlite.prepare(
    `SELECT id, agent_id AS agentId, rule_key AS ruleKey FROM alerts WHERE status IN ('open','acknowledged')`,
  );

  const tx = sqlite.transaction(() => {
    const known = new Set(manifests.map((m) => m.id));
    for (const m of manifests) {
      const runs = recentRuns.all(m.id) as RunSummary[];
      const violations = evaluateRules(m, runs, now);
      const active = activeAlerts.all(m.id) as { id: number; ruleKey: string; message: string }[];
      const activeByKey = new Map(active.map((a) => [a.ruleKey, a]));
      const violatedKeys = new Set<string>();
      for (const v of violations) {
        violatedKeys.add(v.ruleKey);
        const existing = activeByKey.get(v.ruleKey);
        if (!existing) {
          insert.run(m.id, v.ruleKey, v.ruleType, v.severity, v.message, v.runId, now);
          changes.push({ agentId: m.id, ruleKey: v.ruleKey, change: "opened" });
        } else if (existing.message !== v.message) {
          update.run(v.message, v.runId, v.severity, existing.id);
          changes.push({ agentId: m.id, ruleKey: v.ruleKey, change: "updated" });
        }
      }
      for (const a of active) {
        if (!violatedKeys.has(a.ruleKey)) {
          resolve.run(now, a.id);
          changes.push({ agentId: m.id, ruleKey: a.ruleKey, change: "resolved" });
        }
      }
    }
    // Agents whose manifest was deleted: resolve their alerts (only when given the whole registry).
    if (opts.fullRegistry) for (const a of resolveOrphans.all() as { id: number; agentId: string; ruleKey: string }[]) {
      if (!known.has(a.agentId)) {
        resolve.run(now, a.id);
        changes.push({ agentId: a.agentId, ruleKey: a.ruleKey, change: "resolved" });
      }
    }
  });
  tx();
  return changes;
}

export function setAlertStatus(db: DB, id: number, status: "acknowledged" | "resolved", now = Date.now()): boolean {
  const col = status === "acknowledged" ? "acknowledged_at" : "resolved_at";
  const res = db.$client
    .prepare(`UPDATE alerts SET status = ?, ${col} = ? WHERE id = ? AND status != 'resolved'`)
    .run(status, now, id);
  return res.changes > 0;
}
