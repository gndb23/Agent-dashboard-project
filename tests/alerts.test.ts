import { describe, it, expect } from "vitest";
import { evaluateRules, type RunSummary } from "@/lib/alerts/rules";
import { runAlertEngine, setAlertStatus } from "@/lib/alerts/engine";
import { createDb } from "@/lib/db/client";
import { ingestEvents } from "@/lib/events/ingest";
import { listAlerts } from "@/lib/queries";
import type { AgentManifest } from "@/lib/registry/manifest";

const H = 3_600_000;
const NOW = Date.parse("2026-03-10T12:00:00Z");

function manifest(rules: AgentManifest["alert_rules"]): AgentManifest {
  return { id: "a1", name: "A1", description: "", owner: "", type: "claude-code", tags: [], triggers: [], extra_dirs: [], alert_rules: rules };
}
const run = (id: string, status: RunSummary["status"], hoursAgo: number, costUsd = 0): RunSummary => ({
  id, status, startedAt: NOW - hoursAgo * H, endedAt: status === "running" ? null : NOW - hoursAgo * H + 60_000, costUsd,
});

describe("evaluateRules", () => {
  it("consecutive_failures counts the newest streak, skipping running runs", () => {
    const m = manifest([{ type: "consecutive_failures", threshold: 2, severity: "warning" }]);
    expect(evaluateRules(m, [run("r4", "running", 0), run("r3", "failed", 1), run("r2", "failed", 2), run("r1", "success", 3)], NOW)).toHaveLength(1);
    expect(evaluateRules(m, [run("r3", "failed", 1), run("r2", "success", 2), run("r1", "failed", 3)], NOW)).toHaveLength(0);
  });

  it("failures_in_window only counts runs inside the window", () => {
    const m = manifest([{ type: "failures_in_window", threshold: 2, hours: 24, severity: "critical" }]);
    const v = evaluateRules(m, [run("a", "failed", 1), run("b", "success", 2), run("c", "failed", 23)], NOW);
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe("critical");
    expect(evaluateRules(m, [run("a", "failed", 1), run("c", "failed", 30)], NOW)).toHaveLength(0);
  });

  it("runtime_exceeds flags long-running runs only", () => {
    const m = manifest([{ type: "runtime_exceeds", minutes: 30, severity: "warning" }]);
    expect(evaluateRules(m, [run("a", "running", 1)], NOW)[0].runId).toBe("a");
    expect(evaluateRules(m, [run("a", "running", 0.25)], NOW)).toHaveLength(0);
    expect(evaluateRules(m, [run("a", "success", 5)], NOW)).toHaveLength(0);
  });

  it("no_run_within fires when the latest run is too old or missing", () => {
    const m = manifest([{ type: "no_run_within", hours: 13, severity: "warning" }]);
    expect(evaluateRules(m, [run("a", "success", 14)], NOW)).toHaveLength(1);
    expect(evaluateRules(m, [], NOW)[0].message).toMatch(/No runs recorded/);
    expect(evaluateRules(m, [run("a", "success", 2)], NOW)).toHaveLength(0);
  });

  it("cost_per_run_exceeds checks the latest run", () => {
    const m = manifest([{ type: "cost_per_run_exceeds", usd: 2, severity: "warning" }]);
    expect(evaluateRules(m, [run("b", "success", 1, 3), run("a", "success", 2, 0.1)], NOW)).toHaveLength(1);
    expect(evaluateRules(m, [run("b", "success", 1, 0.5), run("a", "success", 2, 9)], NOW)).toHaveLength(0);
  });
});

describe("runAlertEngine", () => {
  const ev = (run_id: string, event_type: string, ts: number, status?: string) =>
    ({ schema_version: 1, agent_id: "a1", run_id, event_type, timestamp: ts, status });

  it("opens, keeps, acknowledges and auto-resolves alerts", () => {
    const db = createDb(":memory:");
    const m = manifest([{ type: "consecutive_failures", threshold: 2, severity: "critical" }]);
    ingestEvents(db, [ev("r1", "run_completed", NOW - 3 * H, "failed"), ev("r2", "run_completed", NOW - 2 * H, "failed")]);

    expect(runAlertEngine(db, [m], NOW)).toEqual([{ agentId: "a1", ruleKey: "consecutive_failures(threshold=2)", change: "opened" }]);
    expect(runAlertEngine(db, [m], NOW)).toEqual([]); // no duplicate
    const [alert] = listAlerts(db, "open");
    expect(alert.severity).toBe("critical");

    expect(setAlertStatus(db, alert.id, "acknowledged", NOW)).toBe(true);
    runAlertEngine(db, [m], NOW);
    expect(listAlerts(db, "acknowledged")).toHaveLength(1);

    ingestEvents(db, ev("r3", "run_completed", NOW - H, "success"));
    expect(runAlertEngine(db, [m], NOW)[0].change).toBe("resolved");
    expect(listAlerts(db, "resolved")).toHaveLength(1);
  });

  it("resolves alerts of deleted agents only on full-registry sweeps", () => {
    const db = createDb(":memory:");
    const m = manifest([{ type: "no_run_within", hours: 1, severity: "warning" }]);
    runAlertEngine(db, [m], NOW);
    expect(listAlerts(db, "open")).toHaveLength(1);
    runAlertEngine(db, [], NOW);
    expect(listAlerts(db, "open")).toHaveLength(1);
    runAlertEngine(db, [], NOW, { fullRegistry: true });
    expect(listAlerts(db, "open")).toHaveLength(0);
  });
});
