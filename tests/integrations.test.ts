import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toEvent, usageFromTranscript, slug } from "../integrations/claude-code/hook.mjs";
import { transcriptToEvents } from "@/lib/importer";
import { agentEventSchema } from "@/lib/events/schema";
import { createDb } from "@/lib/db/client";
import { ingestEvents } from "@/lib/events/ingest";
import { getRun } from "@/lib/queries";
import { claudeHookSettings } from "@/lib/hook-config";

const transcript = [
  { type: "summary", summary: "ignored" },
  { type: "user", uuid: "u1", sessionId: "s-123", cwd: "/home/me/My Project", timestamp: "2026-03-01T10:00:00Z", message: { role: "user", content: "Fix the failing test" } },
  { type: "user", uuid: "u1b", sessionId: "s-123", timestamp: "2026-03-01T10:00:00Z", isMeta: true, message: { role: "user", content: "<command-name>/clear</command-name>" } },
  {
    type: "assistant", uuid: "a1", sessionId: "s-123", timestamp: "2026-03-01T10:00:05Z",
    message: { id: "msg1", model: "claude-opus-5-5", role: "assistant", usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 10000 },
      content: [{ type: "text", text: "Let me look." }, { type: "tool_use", id: "tu1", name: "Bash", input: { command: "npm test" } }] },
  },
  // same message id repeated (streamed content block) must not double count usage
  { type: "assistant", uuid: "a1b", sessionId: "s-123", timestamp: "2026-03-01T10:00:05Z", message: { id: "msg1", model: "claude-opus-5-5", usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 10000 }, content: [] } },
  { type: "user", uuid: "u2", sessionId: "s-123", timestamp: "2026-03-01T10:00:09Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: "1 failing" }] } },
  "not json",
].map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n");

describe("Claude Code hook", () => {
  const h = { session_id: "s1", cwd: "/work/Portfolio Research" };

  it("derives agent id from AGENT_ID or the folder name", () => {
    expect(toEvent({ ...h, hook_event_name: "SessionStart" }, {})!.agent_id).toBe("portfolio-research");
    expect(toEvent({ ...h, hook_event_name: "SessionStart" }, { AGENT_ID: "Custom_ID" })!.agent_id).toBe("custom_id");
    expect(slug("--Hello World!!")).toBe("hello-world");
  });

  it("maps every supported hook to a valid v1 event", () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["SessionStart", { source: "startup" }, "run_started"],
      ["UserPromptSubmit", { prompt: "hi" }, "message"],
      ["PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }, "tool_called"],
      ["PostToolUse", { tool_name: "Bash", tool_response: { stdout: "ok" } }, "tool_result"],
      ["Notification", { message: "needs permission" }, "message"],
      ["SubagentStop", {}, "message"],
      ["Stop", {}, "run_completed"],
      ["SessionEnd", { reason: "exit" }, "run_completed"],
    ];
    for (const [name, extra, type] of cases) {
      const e = toEvent({ ...h, hook_event_name: name, ...extra }, {});
      expect(e?.event_type, name).toBe(type);
      expect(agentEventSchema.safeParse(e).success, name).toBe(true);
    }
    expect(toEvent({ ...h, hook_event_name: "SomethingNew" }, {})).toBeNull();
  });

  it("flags tool errors and clips large payloads", () => {
    const e = toEvent({ ...h, hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: { error: "boom", stdout: "x".repeat(10_000) } }, {})!;
    expect(e.status).toBe("error");
    expect(e.payload.output.length).toBeLessThan(2200);
  });

  it("reads cumulative usage from the transcript on Stop", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tr-")), "t.jsonl");
    fs.writeFileSync(f, transcript);
    const u = usageFromTranscript(f)!;
    expect(u.tokens_in).toBe(11_000);
    expect(u.tokens_out).toBe(100);
    expect(u.cost_usd).toBeCloseTo((1000 * 4 + 10_000 * 0.4 + 100 * 20) / 1e6, 6);
    const e = toEvent({ ...h, hook_event_name: "Stop", transcript_path: f }, {})!;
    expect(e.metrics_cumulative).toBe(true);
    expect(usageFromTranscript("/nope.jsonl")).toBeNull();
  });

  it("generates a settings block covering every hook", () => {
    const s = claudeHookSettings({ root: "/opt/agent-ops", agentId: "my-agent" });
    expect(Object.keys(s.hooks)).toContain("PreToolUse");
    expect(JSON.stringify(s)).toContain('node \\"/opt/agent-ops/integrations/claude-code/hook.mjs\\" --agent-id my-agent');
  });
});

describe("transcript importer", () => {
  it("converts a transcript into a complete, idempotent run", () => {
    const events = transcriptToEvents(transcript, { fileName: "/x/s-123.jsonl" });
    expect(events.map((e) => e.event_type)).toEqual(["run_started", "message", "tool_called", "tool_result", "run_completed"]);
    expect(events[0].agent_id).toBe("my-project");
    for (const e of events) expect(agentEventSchema.safeParse(e).success).toBe(true);

    const db = createDb(":memory:");
    ingestEvents(db, events);
    expect(ingestEvents(db, events).duplicates).toBe(events.length);
    const run = getRun(db, "s-123")!.run;
    expect(run).toMatchObject({ status: "success", title: "Fix the failing test", toolCount: 1, errorCount: 1, tokensIn: 11_000, tokensOut: 100 });
    expect(run.durationMs).toBe(9000);
  });

  it("returns nothing for empty or undated transcripts", () => {
    expect(transcriptToEvents("", { fileName: "a.jsonl" })).toEqual([]);
    expect(transcriptToEvents('{"type":"summary"}', { fileName: "a.jsonl" })).toEqual([]);
  });
});
