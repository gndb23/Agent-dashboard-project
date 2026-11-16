#!/usr/bin/env node
// Stand-in for the Claude Code CLI used by tests: mimics `claude -p --output-format stream-json`.
const args = process.argv.slice(2);
let input = "";
for await (const c of process.stdin) input += c;
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const resume = args.includes("--resume") ? args[args.indexOf("--resume") + 1] : null;
const sessionId = resume ?? "sess-fake-1";

if (input.includes("FAIL")) {
  process.stderr.write("fake: something broke\n");
  process.exit(2);
}
out({ type: "system", subtype: "init", session_id: sessionId });
if (input.includes("NOLOGIN")) {
  // What the real CLI does when logged out: the message arrives as an assistant reply AND as the error result.
  out({ type: "assistant", message: { content: [{ type: "text", text: "Not logged in · Please run /login" }] } });
  out({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login", session_id: sessionId });
  process.exit(1);
}
if (input.includes("SLOW")) await new Promise((r) => setTimeout(r, 30_000));
out({ type: "stream_event", event: { type: "message_start" } });
for (const t of ["You said: ", input, ` (cwd=${process.cwd()}, agent=${process.env.AGENT_ID}, mode=${args[args.indexOf("--permission-mode") + 1]}, resumed=${resume ?? "no"})`]) {
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } });
}
out({ type: "assistant", message: { content: [{ type: "text", text: "ignored because deltas were streamed" }, { type: "tool_use", name: "Read", input: { file_path: "README.md" } }] } });
out({ type: "result", subtype: "success", is_error: false, result: "final", session_id: sessionId, total_cost_usd: 0.0123 });
