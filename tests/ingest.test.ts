import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/client";
import { ingestEvents } from "@/lib/events/ingest";
import { getRun, getKpis, getActivity } from "@/lib/queries";

let db: DB;
const T0 = Date.parse("2026-03-01T10:00:00Z");
const ev = (o: Record<string, unknown>) => ({ schema_version: 1, agent_id: "a1", run_id: "r1", ...o });

beforeEach(() => {
  db = createDb(":memory:");
});

describe("ingestEvents", () => {
  it("creates a run and aggregates a full lifecycle", () => {
    const res = ingestEvents(db, [
      ev({ event_type: "run_started", timestamp: T0 }),
      ev({ event_type: "message", timestamp: T0 + 1000, payload: { text: "Summarise the market" } }),
      ev({ event_type: "tool_called", timestamp: T0 + 2000, payload: { tool: "WebSearch" } }),
      ev({ event_type: "tool_result", timestamp: T0 + 3000, status: "error" }),
      ev({ event_type: "run_completed", timestamp: T0 + 60_000, metrics: { tokens_in: 100, tokens_out: 50, cost_usd: 0.01 } }),
    ]);
    expect(res).toMatchObject({ accepted: 5, duplicates: 0, rejected: [] });
    const r = getRun(db, "r1")!.run;
    expect(r).toMatchObject({
      status: "success", title: "Summarise the market", eventCount: 5, toolCount: 1, errorCount: 1,
      tokensIn: 100, tokensOut: 50, durationMs: 60_000, startedAt: T0, endedAt: T0 + 60_000,
    });
  });

  it("accepts ISO and epoch-second timestamps", () => {
    ingestEvents(db, [
      ev({ event_type: "run_started", timestamp: "2026-03-01T10:00:00Z" }),
      ev({ event_type: "heartbeat", timestamp: T0 / 1000 + 5 }),
    ]);
    const r = getRun(db, "r1")!.run;
    expect(r.startedAt).toBe(T0);
    expect(r.lastEventAt).toBe(T0 + 5000);
  });

  it("rejects invalid events with readable errors and keeps valid ones", () => {
    const res = ingestEvents(db, [
      ev({ event_type: "run_started" }),
      { schema_version: 2, agent_id: "a1", run_id: "r1", event_type: "run_started" },
      ev({ event_type: "teleported" }),
      ev({ agent_id: "Has Spaces", event_type: "message" }),
    ]);
    expect(res.accepted).toBe(1);
    expect(res.rejected.map((r) => r.index)).toEqual([1, 2, 3]);
    expect(res.rejected[1].error).toMatch(/event_type/);
  });

  it("is idempotent for events with event_id", () => {
    const batch = [ev({ event_type: "run_started", event_id: "e1", timestamp: T0 }), ev({ event_type: "tool_called", event_id: "e2", timestamp: T0 + 1 })];
    ingestEvents(db, batch);
    const again = ingestEvents(db, batch);
    expect(again).toMatchObject({ accepted: 0, duplicates: 2 });
    expect(getRun(db, "r1")!.run.eventCount).toBe(2);
  });

  it("maps final statuses and reopens a completed run on new activity", () => {
    ingestEvents(db, [ev({ event_type: "run_started", timestamp: T0 }), ev({ event_type: "run_completed", status: "error", timestamp: T0 + 10 })]);
    expect(getRun(db, "r1")!.run.status).toBe("failed");
    ingestEvents(db, ev({ event_type: "message", timestamp: T0 + 20, payload: { text: "next turn" } }));
    const r = getRun(db, "r1")!.run;
    expect(r.status).toBe("running");
    expect(r.endedAt).toBeNull();
  });

  it("does not reopen on late/out-of-order or heartbeat events", () => {
    ingestEvents(db, [ev({ event_type: "run_started", timestamp: T0 }), ev({ event_type: "run_completed", timestamp: T0 + 100 })]);
    ingestEvents(db, [ev({ event_type: "tool_called", timestamp: T0 + 50 }), ev({ event_type: "heartbeat", timestamp: T0 + 500 })]);
    expect(getRun(db, "r1")!.run.status).toBe("success");
  });

  it("sums delta metrics and max-merges cumulative metrics", () => {
    ingestEvents(db, [
      ev({ event_type: "message", timestamp: T0, metrics: { tokens_in: 10, cost_usd: 0.5 } }),
      ev({ event_type: "message", timestamp: T0 + 1, metrics: { tokens_in: 5, cost_usd: 0.25 } }),
    ]);
    expect(getRun(db, "r1")!.run).toMatchObject({ tokensIn: 15, costUsd: 0.75 });
    ingestEvents(db, [
      ev({ run_id: "r2", event_type: "run_completed", timestamp: T0, metrics: { tokens_in: 1000 }, metrics_cumulative: true }),
      ev({ run_id: "r2", event_type: "run_completed", timestamp: T0 + 5, metrics: { tokens_in: 1200 }, metrics_cumulative: true }),
    ]);
    expect(getRun(db, "r2")!.run.tokensIn).toBe(1200);
  });

  it("refuses to attach a run_id to a different agent", () => {
    ingestEvents(db, ev({ event_type: "run_started", timestamp: T0 }));
    const res = ingestEvents(db, ev({ agent_id: "a2", event_type: "message", timestamp: T0 + 1 }));
    expect(res.accepted).toBe(0);
    expect(res.rejected[0].error).toMatch(/already belongs/);
    expect(getActivity(db).length).toBe(1);
  });

  it("truncates oversized payloads", () => {
    ingestEvents(db, ev({ event_type: "message", timestamp: T0, payload: { text: "x".repeat(100_000) } }));
    const e = getRun(db, "r1")!.events[0];
    expect(e.payload?._truncated).toBe(true);
  });

  it("feeds the KPI query", () => {
    const now = T0 + 120_000;
    ingestEvents(db, [
      ev({ event_type: "run_started", timestamp: T0 }),
      ev({ event_type: "run_completed", timestamp: T0 + 10, metrics: { cost_usd: 1.5 } }),
      ev({ run_id: "r2", event_type: "run_started", timestamp: T0 }),
      ev({ run_id: "r2", event_type: "run_completed", status: "failed", timestamp: T0 + 10 }),
      ev({ run_id: "r3", event_type: "run_started", timestamp: now - 1000 }),
    ]);
    const k = getKpis(db, now);
    expect(k).toMatchObject({ activeNow: 1, failures24h: 1, completed24h: 2, successRate24h: 0.5, cost24h: 1.5 });
  });
});
