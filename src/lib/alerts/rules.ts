import { ruleKey, type AgentManifest, type AlertRule } from "../registry/manifest";

export type RunSummary = {
  id: string;
  status: "running" | "success" | "failed" | "cancelled";
  startedAt: number;
  endedAt: number | null;
  costUsd: number;
};

export type Violation = {
  ruleKey: string;
  ruleType: AlertRule["type"];
  severity: "warning" | "critical";
  message: string;
  runId: string | null;
};

const HOUR = 3_600_000;
const MIN = 60_000;

function fmtMinutes(ms: number) {
  const m = Math.round(ms / MIN);
  return m >= 120 ? `${(m / 60).toFixed(1)}h` : `${m}m`;
}

/**
 * Pure rule evaluation. `runs` must be the agent's recent runs, newest first.
 * Returns the set of rules currently in violation.
 */
export function evaluateRules(manifest: AgentManifest, runs: RunSummary[], now: number): Violation[] {
  const out: Violation[] = [];
  for (const rule of manifest.alert_rules) {
    const base = { ruleKey: ruleKey(rule), ruleType: rule.type, severity: rule.severity };
    switch (rule.type) {
      case "consecutive_failures": {
        let streak = 0;
        for (const r of runs) {
          if (r.status === "running") continue;
          if (r.status === "failed") streak++;
          else break;
        }
        if (streak >= rule.threshold) {
          out.push({ ...base, runId: runs.find((r) => r.status === "failed")?.id ?? null,
            message: `${streak} consecutive failed runs (threshold ${rule.threshold})` });
        }
        break;
      }
      case "failures_in_window": {
        const since = now - rule.hours * HOUR;
        const failed = runs.filter((r) => r.status === "failed" && r.startedAt >= since);
        if (failed.length >= rule.threshold) {
          out.push({ ...base, runId: failed[0].id,
            message: `${failed.length} failed runs in the last ${rule.hours}h (threshold ${rule.threshold})` });
        }
        break;
      }
      case "runtime_exceeds": {
        const limit = rule.minutes * MIN;
        const slow = runs.find((r) => r.status === "running" && now - r.startedAt > limit);
        if (slow) {
          out.push({ ...base, runId: slow.id,
            message: `Run has been going for ${fmtMinutes(now - slow.startedAt)} (limit ${rule.minutes}m)` });
        }
        break;
      }
      case "no_run_within": {
        const latest = runs[0];
        const age = latest ? now - latest.startedAt : Infinity;
        if (age > rule.hours * HOUR) {
          out.push({ ...base, runId: null,
            message: latest
              ? `No run in the last ${rule.hours}h (last run ${fmtMinutes(age)} ago)`
              : `No runs recorded yet (expected one within ${rule.hours}h)` });
        }
        break;
      }
      case "cost_per_run_exceeds": {
        // Evaluated against the most recent run only, so the alert clears once a cheaper run follows.
        const latest = runs[0];
        if (latest && latest.costUsd > rule.usd) {
          out.push({ ...base, runId: latest.id,
            message: `${latest.status === "running" ? "Current run has cost" : "Latest run cost"} $${latest.costUsd.toFixed(2)} (limit $${rule.usd.toFixed(2)})` });
        }
        break;
      }
    }
  }
  return out;
}
