#!/usr/bin/env node
/**
 * Agent Ops supervisor: keeps the dashboard running in the background, with no terminal.
 *
 *   node scripts/supervisor.mjs            # used by the Windows launcher (hidden) and start.sh
 *
 * - Exits right away if the dashboard is already running (safe to launch twice).
 * - First run: installs dependencies and builds, serving a "Setting up…" page meanwhile.
 * - Restarts the server if it crashes (with back-off).
 * - "Update" from Settings: the server exits with code 75 → git pull, reinstall if the
 *   lockfile changed, rebuild, restart. Progress is shown on http://localhost:4321.
 * - Logs: data/logs/supervisor.log and data/logs/server.log
 *
 * Plain Node, no dependencies, so it works before `npm install` has run.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.AGENT_OPS_PORT || 4321);
const HOST = "127.0.0.1";
const LOG_DIR = path.join(ROOT, "data", "logs");
const STATUS_FILE = path.join(ROOT, "data", "update-status.json");
const UPDATE_EXIT = 75;
fs.mkdirSync(LOG_DIR, { recursive: true });

const logFile = path.join(LOG_DIR, "supervisor.log");
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5_000_000) fs.renameSync(logFile, logFile + ".1");
    fs.appendFileSync(logFile, line);
  } catch {}
  if (process.stdout.isTTY) process.stdout.write(line);
}

let status = { state: "starting", step: "Starting", detail: "", startedAt: Date.now(), error: null };
function setStatus(patch) {
  status = { ...status, ...patch };
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  } catch {}
  log(`${status.state}: ${status.step}${status.detail ? ` — ${status.detail}` : ""}`);
}

// ------------------------------------------------------------------ helpers

function health() {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: "/api/health", timeout: 1500 }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve(res.statusCode === 200 && body.includes("agent-ops") ? body : null));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** npm without going through npm.cmd / a shell (works on Windows even with scripts disabled). */
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  return candidates.find((c) => c.endsWith(".js") && fs.existsSync(c)) || null;
}

/** Runs a setup step without blocking, so the "getting ready" page keeps answering. */
function run(cmd, args, label) {
  setStatus({ step: label, detail: "" });
  const out = fs.openSync(path.join(LOG_DIR, "setup.log"), "a");
  fs.writeSync(out, `\n=== ${new Date().toISOString()} ${label}: ${cmd} ${args.join(" ")}\n`);
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", out, out], windowsHide: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
    p.on("error", (e) => {
      fs.closeSync(out);
      reject(new Error(`${label} failed: ${e.message}`));
    });
    p.on("exit", (code) => {
      fs.closeSync(out);
      code === 0 ? resolve() : reject(new Error(`${label} failed (exit ${code}). See data/logs/setup.log`));
    });
  });
}

function npm(args, label) {
  const cli = npmCli();
  if (cli) return run(process.execPath, [cli, ...args], label);
  return run(process.platform === "win32" ? "npm.cmd" : "npm", args, label);
}

function sqliteWorks() {
  const r = spawnSync(process.execPath, ["-e", "require('better-sqlite3')(':memory:').prepare('select 1').get()"], { cwd: ROOT, windowsHide: true });
  return r.status === 0;
}

function hash(file) {
  try {
    const s = fs.statSync(file);
    return `${s.size}:${fs.readFileSync(file).reduce((a, b) => (a * 31 + b) >>> 0, 7)}`;
  } catch {
    return "missing";
  }
}

async function ensureInstalled(force = false) {
  const marker = path.join(ROOT, "node_modules", ".agent-ops-lock");
  const lock = hash(path.join(ROOT, "package-lock.json"));
  const installed = fs.existsSync(path.join(ROOT, "node_modules", "next")) && fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === lock;
  if (force || !installed) {
    await npm(["install", "--no-audit", "--no-fund"], "Installing dependencies (first time takes a few minutes)");
    fs.writeFileSync(marker, lock);
  }
  if (!sqliteWorks()) {
    try {
      await npm(["install-scripts", "approve", "better-sqlite3", "esbuild"], "Allowing the database driver to build");
    } catch {
      /* older npm: no such command, nothing to approve */
    }
    await npm(["rebuild", "better-sqlite3"], "Building the database driver");
    if (!sqliteWorks()) throw new Error("The database driver (better-sqlite3) could not be loaded. See data/logs/setup.log");
  }
}

function buildId() {
  try {
    return fs.readFileSync(path.join(ROOT, ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return null;
  }
}

async function ensureBuilt(force = false) {
  const stamp = path.join(ROOT, ".next", "agent-ops-source");
  const head = gitHead();
  const fresh = buildId() && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === head;
  if (force || !fresh) {
    await run(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], "Building the dashboard (about a minute)");
    fs.writeFileSync(stamp, head);
  }
}

function gitHead() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, windowsHide: true, encoding: "utf8" });
  if (r.status === 0) return r.stdout.trim();
  // No git: use package.json + source mtimes as a stand-in
  return `nogit:${hash(path.join(ROOT, "package.json"))}:${fs.statSync(path.join(ROOT, "src")).mtimeMs}`;
}

function gitPull() {
  if (!fs.existsSync(path.join(ROOT, ".git"))) return "Not a git checkout: skipped download";
  const r = spawnSync("git", ["pull", "--ff-only"], { cwd: ROOT, windowsHide: true, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`Downloading the update failed: ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" ")}`);
  return r.stdout.trim().split("\n").pop();
}

// ------------------------------------------------------------------ status page while busy

const PAGE = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Ops · ${status.state === "error" ? "Problem" : "Getting ready"}</title><meta http-equiv="refresh" content="3">
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0c10;color:#e9ebf1;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.card{max-width:520px;padding:32px;border:1px solid #222734;border-radius:14px;background:#10131a}h1{font-size:20px;margin:0 0 6px}p{color:#a4acbc;margin:6px 0}
.bar{height:4px;background:#1b202a;border-radius:4px;overflow:hidden;margin:18px 0 8px}.bar i{display:block;height:100%;width:40%;background:#9085ff;animation:m 1.4s ease-in-out infinite}
@keyframes m{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}.err{color:#f7797f;white-space:pre-wrap}code{color:#e9ebf1}</style></head>
<body><div class="card"><h1>${status.state === "error" ? "Agent Ops couldn't start" : "Agent Ops is getting ready…"}</h1>
<p>${escapeHtml(status.step)}</p>${status.state === "error" ? `<p class="err">${escapeHtml(status.error || "")}</p><p>Details: <code>data/logs/setup.log</code>. It will retry in a minute.</p>` : `<div class="bar"><i></i></div><p>This page refreshes by itself.</p>`}</div></body></html>`;
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let statusServer = null;
function serveStatus() {
  if (statusServer) return Promise.resolve();
  return new Promise((resolve) => {
    statusServer = http.createServer((req, res) => {
      if (req.url?.startsWith("/api/health")) {
        res.writeHead(503, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: false, service: "agent-ops-supervisor", status }));
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(PAGE());
    });
    statusServer.on("error", (e) => {
      log(`status page could not listen: ${e.message}`);
      statusServer = null;
      resolve();
    });
    statusServer.listen(PORT, HOST, resolve);
  });
}
function stopStatus() {
  return new Promise((resolve) => (statusServer ? statusServer.close(() => ((statusServer = null), resolve())) : resolve()));
}

// ------------------------------------------------------------------ main loop

let child = null;
let quitting = false;

function startServer() {
  const out = fs.openSync(path.join(LOG_DIR, "server.log"), "a");
  setStatus({ state: "running", step: "Running", detail: `http://localhost:${PORT}`, error: null });
  child = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-H", HOST, "-p", String(PORT)], {
    cwd: ROOT,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: { ...process.env, AGENT_OPS_SUPERVISED: "1", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
  });
  return new Promise((resolve) => child.on("exit", (code) => {
    fs.closeSync(out);
    child = null;
    resolve(code ?? 1);
  }));
}

async function prepare({ update = false } = {}) {
  await serveStatus();
  setStatus({ state: update ? "updating" : "preparing", error: null });
  if (update) setStatus({ step: "Downloading the latest version", detail: gitPull() || "" });
  await ensureInstalled();
  await ensureBuilt(update);
  await stopStatus();
}

async function main() {
  if (await health()) {
    log("Agent Ops is already running; nothing to do.");
    return;
  }
  let failures = 0;
  let update = false;
  while (!quitting) {
    try {
      await prepare({ update });
      update = false;
      const started = Date.now();
      const code = await startServer();
      if (quitting) break;
      if (code === UPDATE_EXIT) {
        update = true;
        failures = 0;
        continue;
      }
      failures = Date.now() - started > 60_000 ? 0 : failures + 1;
      log(`server exited with code ${code}; restarting (attempt ${failures})`);
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** failures)));
    } catch (e) {
      update = false;
      setStatus({ state: "error", step: "Setup failed", error: e.message });
      await serveStatus();
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    quitting = true;
    if (child) child.kill();
    stopStatus().then(() => process.exit(0));
  });
}

main().catch((e) => {
  log(`fatal: ${e.stack || e.message}`);
  process.exit(1);
});
