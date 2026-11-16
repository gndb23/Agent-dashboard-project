export {};
/**
 * End-to-end check of the HTTP API: simulates one agent run over ~6 seconds.
 *   npm run dev                  # in another terminal
 *   npm run send-sample-events   # watch it appear live on the dashboard
 */
const BASE = (process.env.AGENT_OPS_URL ?? "http://localhost:4321").replace(/\/$/, "");
const agent = process.argv[2] ?? "sample-agent";
const runId = `sample-${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(event_type: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schema_version: 1, agent_id: agent, run_id: runId, event_type, source: "sample-script", ...extra }),
  });
  const body = await res.json();
  console.log(`${res.status} ${event_type.padEnd(14)} ${JSON.stringify(body)}`);
  if (!res.ok) process.exitCode = 1;
}

const health = await fetch(`${BASE}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(`Dashboard not reachable at ${BASE}. Start it with: npm run dev`);
  process.exit(1);
}
await send("run_started", { payload: { title: "Sample run from send-sample-events" } });
for (const tool of ["WebSearch", "Read", "Bash"]) {
  await sleep(1000);
  await send("tool_called", { payload: { tool, summary: `demo ${tool.toLowerCase()} call` } });
  await sleep(500);
  await send("tool_result", { status: "ok", payload: { tool } });
}
await sleep(800);
await send("run_completed", { status: "success", metrics: { tokens_in: 4200, tokens_out: 900, cost_usd: 0.03 } });

// contract violation → expect 400 with a readable error
const bad = await fetch(`${BASE}/api/events`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ schema_version: 1, agent_id: agent, event_type: "nope" }),
});
console.log(`${bad.status} (expected 400 for an invalid event)`);
console.log(`\nOpen ${BASE}/runs/${runId}`);
