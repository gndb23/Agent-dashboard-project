import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { layoutGraph, edgePath, NODE_W } from "@/lib/workflow";
import { createDb } from "@/lib/db/client";
import { ingestEvents } from "@/lib/events/ingest";
import { getChildRuns, getRun, getWorkflowEdges } from "@/lib/queries";
import { loadRegistry } from "@/lib/registry/registry";
import { toEvent } from "../integrations/claude-code/hook.mjs";

describe("layoutGraph", () => {
  it("layers nodes left to right and separates unlinked ones", () => {
    const l = layoutGraph(["a", "b", "c", "d", "solo"], [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }]);
    const layer = Object.fromEntries(l.nodes.map((n) => [n.id, n.layer]));
    expect(layer).toEqual({ a: 0, b: 1, c: 1, d: 2 });
    expect(l.unlinked).toEqual(["solo"]);
    expect(l.layers).toBe(3);
    const pos = Object.fromEntries(l.nodes.map((n) => [n.id, n]));
    expect(pos.b.x).toBeGreaterThan(pos.a.x + NODE_W);
    expect(pos.b.y).not.toBe(pos.c.y);
    expect(l.width).toBeGreaterThan(0);
  });

  it("puts a node after its longest chain and survives cycles, self-links and unknown ids", () => {
    const long = layoutGraph(["a", "b", "c"], [{ from: "a", to: "c" }, { from: "a", to: "b" }, { from: "b", to: "c" }]);
    expect(long.nodes.find((n) => n.id === "c")!.layer).toBe(2);
    const cyc = layoutGraph(["a", "b"], [{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "a", to: "a" }, { from: "a", to: "ghost" }]);
    expect(cyc.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(new Set(cyc.nodes.map((n) => n.layer))).toEqual(new Set([0, 1]));
    const back = edgePath(cyc.nodes.find((n) => n.layer === 1)!, cyc.nodes.find((n) => n.layer === 0)!);
    expect(back.d.startsWith("M")).toBe(true);
    expect(layoutGraph([], [])).toMatchObject({ nodes: [], unlinked: [], width: 0, height: 0 });
  });
});

describe("handoffs (parent_run_id)", () => {
  const T = Date.parse("2026-03-01T10:00:00Z");
  const ev = (o: Record<string, unknown>) => ({ schema_version: 1, event_type: "run_started", timestamp: T, ...o });

  it("records the parent on a run and resolves the parent agent when omitted", () => {
    const db = createDb(":memory:");
    ingestEvents(db, [
      ev({ agent_id: "planner", run_id: "p1" }),
      ev({ agent_id: "worker", run_id: "w1", parent_run_id: "p1" }), // parent agent looked up
      ev({ agent_id: "worker", run_id: "w2", parent_run_id: "p-unknown", parent_agent_id: "planner" }),
      ev({ agent_id: "worker", run_id: "w3", parent_run_id: "w3" }), // self-parent ignored
      ev({ agent_id: "worker", run_id: "w1", event_type: "message", parent_run_id: "other" }), // first writer wins
    ]);
    expect(getRun(db, "w1")!.run).toMatchObject({ parentRunId: "p1", parentAgentId: "planner" });
    expect(getRun(db, "w2")!.run).toMatchObject({ parentRunId: "p-unknown", parentAgentId: "planner" });
    expect(getRun(db, "w3")!.run.parentRunId).toBeNull();
    expect(getChildRuns(db, "p1").map((r) => r.id)).toEqual(["w1"]);
  });

  it("merges declared and detected links", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-"));
    fs.writeFileSync(path.join(dir, "planner.yaml"), "id: planner\nname: Planner\ntriggers: [worker, reviewer, ghost]\n");
    fs.writeFileSync(path.join(dir, "worker.yaml"), "id: worker\nname: Worker\n");
    fs.writeFileSync(path.join(dir, "reviewer.yaml"), "id: reviewer\nname: Reviewer\n");
    const reg = loadRegistry(dir);
    expect(reg.agents).toHaveLength(3); // bad trigger does not unload the agent
    expect(reg.errors[0].error).toMatch(/unknown agent "ghost"/);

    const db = createDb(":memory:");
    const now = T + 1000;
    ingestEvents(db, [
      ev({ agent_id: "planner", run_id: "p1" }),
      ev({ agent_id: "worker", run_id: "w1", parent_run_id: "p1" }),
      ev({ agent_id: "worker", run_id: "w2", parent_run_id: "p1" }),
      ev({ agent_id: "worker", run_id: "w-old", parent_run_id: "p1", timestamp: T - 30 * 86_400_000 }),
      ev({ agent_id: "adhoc", run_id: "x1", parent_run_id: "w1" }),
    ]);
    const edges = getWorkflowEdges(db, reg, now);
    expect(edges).toEqual([
      expect.objectContaining({ from: "planner", to: "reviewer", kind: "declared", handoffs7d: 0, handoffsTotal: 0, lastHandoffAt: null }),
      expect.objectContaining({ from: "planner", to: "worker", kind: "both", handoffs7d: 2, handoffsTotal: 3 }),
      expect.objectContaining({ from: "worker", to: "adhoc", kind: "detected", handoffs7d: 1 }),
    ]);
  });

  it("the hook forwards parent info from the environment", () => {
    const e = toEvent({ hook_event_name: "SessionStart", session_id: "s", cwd: "/x/child" }, { AGENT_OPS_PARENT_RUN_ID: "p1", AGENT_OPS_PARENT_AGENT_ID: "Planner" })!;
    expect(e).toMatchObject({ parent_run_id: "p1", parent_agent_id: "planner" });
    expect(toEvent({ hook_event_name: "SessionStart", session_id: "s", cwd: "/x/child" }, {})!.parent_run_id).toBeUndefined();
  });

  it("migrates an existing database by adding the new columns", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "db-")), "old.db");
    const old = createDb(file);
    old.$client.exec("ALTER TABLE runs DROP COLUMN parent_agent_id; DROP INDEX runs_parent_idx; ALTER TABLE runs DROP COLUMN parent_run_id; DROP TABLE chat_messages;");
    old.$client.prepare("INSERT INTO runs (id, agent_id, status, started_at, last_event_at) VALUES ('r', 'a', 'success', 1, 1)").run();
    old.$client.close();
    const db = createDb(file);
    expect(getRun(db, "r")!.run.parentRunId).toBeNull();
    expect(db.$client.prepare("SELECT COUNT(*) c FROM chat_messages").get()).toEqual({ c: 0 });
  });
});
