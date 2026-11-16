#!/usr/bin/env node
/**
 * End-to-end smoke test against a production build (used by CI on Windows and Linux).
 *   npm run build && node scripts/smoke.mjs
 * Starts the server on a spare port with a fake Claude CLI and a fake Claude scheduled task,
 * then checks pages, the event API, task sync, agent creation, Run now and chat.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ops-smoke-"));
const failures = [];
const check = (name, ok, info = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
  if (!ok) failures.push(name);
};

// Fake Claude scheduled task + app settings
const tasks = path.join(tmp, "scheduled-tasks");
fs.mkdirSync(path.join(tasks, "smoke-inventory-sync"), { recursive: true });
fs.writeFileSync(path.join(tasks, "smoke-inventory-sync", "SKILL.md"), "---\nname: smoke-inventory-sync\ndescription: Smoke task\n---\n\nCompare stock levels.\n");
const work = path.join(tmp, "work");
fs.mkdirSync(work, { recursive: true });
const appDir = path.join(tmp, "app");
fs.mkdirSync(appDir, { recursive: true });
fs.writeFileSync(path.join(appDir, "scheduled-tasks.json"), JSON.stringify({ tasks: [{ name: "smoke-inventory-sync", cronExpression: "0 8 * * *", cwd: work, enabled: true }] }));

const env = {
  ...process.env,
  AGENT_OPS_DB: path.join(tmp, "smoke.db"),
  AGENT_OPS_DATA_DIR: path.join(tmp, "data"),
  AGENT_OPS_AGENTS_DIR: path.join(tmp, "agents"),
  AGENT_OPS_TASK_DIRS: tasks,
  AGENT_OPS_CLAUDE_APP_DIR: appDir,
  AGENT_OPS_CLAUDE_BIN: path.join(ROOT, "tests", "fixtures", "fake-claude.mjs"),
  CLAUDE_CONFIG_DIR: path.join(tmp, "claude-config"),
  HOME: tmp,
  USERPROFILE: tmp,
  NEXT_TELEMETRY_DISABLED: "1",
};
fs.mkdirSync(env.AGENT_OPS_AGENTS_DIR, { recursive: true });

const server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(PORT)], {
  cwd: ROOT,
  env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (p, init) => {
  const r = await fetch(BASE + p, init);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const post = (p, body, method = "POST") => json(p, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(1000);
    up = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
  }
  check("server starts", up);
  if (!up) throw new Error("server did not start");

  for (const p of ["/", "/agents", "/agents/new", "/runs", "/workflow", "/usage", "/alerts", "/settings", "/onboarding"]) {
    const r = await fetch(BASE + p);
    check(`page ${p}`, r.status === 200, String(r.status));
  }

  const ev = await post("/api/events", { schema_version: 1, agent_id: "smoke-agent", run_id: "smoke-1", event_type: "run_started" });
  check("event API accepts an event", ev.status === 202);
  const bad = await post("/api/events", { schema_version: 1, agent_id: "smoke-agent", event_type: "nope" });
  check("event API rejects a bad event", bad.status === 400);

  const agents = await json("/api/agents");
  const task = agents.body?.find((a) => a.id === "smoke-inventory-sync");
  check("Claude scheduled task appears as an agent", Boolean(task) && task.schedule === "0 8 * * *" && task.origin?.kind === "claude-task", task ? `${task.schedule}` : "missing");

  const sys = await json("/api/system");
  check("system health endpoint", sys.status === 200 && Array.isArray(sys.body?.checks));

  const created = await post("/api/agents", { name: "Smoke Writer", instructions: "Say hello.", schedule: "daily 09:00", projectDir: path.join(tmp, "smoke-writer") });
  check("create an agent", created.status === 201 && created.body?.id === "smoke-writer", JSON.stringify(created.body));
  check("agent folder + CLAUDE.md created", fs.existsSync(path.join(tmp, "smoke-writer", "CLAUDE.md")));

  const patched = await post("/api/agents/smoke-writer", { description: "Edited in smoke test", scheduleText: "weekdays 08:00" }, "PATCH");
  const after = (await json("/api/agents")).body?.find((a) => a.id === "smoke-writer");
  check("edit agent settings", patched.status === 200 && after?.schedule === "0 8 * * 1-5" && after?.description === "Edited in smoke test");

  const run = await post("/api/agents/smoke-writer/run", {});
  check("Run now starts", run.status === 202, JSON.stringify(run.body));
  let done = null;
  for (let i = 0; i < 30 && !done; i++) {
    await sleep(1000);
    const evs = (await json("/api/events?agent_id=smoke-writer&limit=50")).body ?? [];
    done = evs.find((e) => e.eventType === "run_completed");
  }
  check("Run now completes and is recorded", Boolean(done) && done.status === "success", done ? done.status : "no run_completed");

  const chatRes = await fetch(`${BASE}/api/agents/smoke-inventory-sync/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hello from smoke" }) });
  const chatText = (await chatRes.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  check("chat with a task agent streams a reply", chatRes.status === 200 && chatText.includes("You said: hello from smoke"), chatText.slice(0, 160));
  check("chat runs in the task's working folder", chatText.includes(`cwd=${work}`) || chatText.includes(`cwd=${fs.realpathSync(work)}`));

  const archived = await json("/api/agents/smoke-writer", { method: "DELETE" });
  check("archive an agent", archived.status === 200);
} catch (e) {
  check("smoke run", false, e.message);
} finally {
  server.kill();
  await sleep(500);
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed. Server log:\n${serverLog.slice(-4000)}`);
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
process.exit(0);
