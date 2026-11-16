#!/usr/bin/env node
/**
 * Agent Ops — Claude Code hook.
 *
 * Reads the hook JSON Claude Code writes to stdin and forwards a normalized
 * event to the dashboard (POST $AGENT_OPS_URL/api/events).
 *
 * Guarantees: never blocks or fails the agent. Fire-and-forget, 1s timeout,
 * prints nothing, always exits 0.
 *
 * Agent id, first match wins:
 *   1. --agent-id <id> argument          (Windows-safe way to pin it in settings.json)
 *   2. AGENT_ID environment variable
 *   3. .claude/agent-ops.json in the session folder or any parent folder
 *      (written by `npm run register`: { "agent_id": "...", "url": "..." })
 *   4. the project folder name, slugified
 *
 * Dashboard URL: --url <url>, then AGENT_OPS_URL, then agent-ops.json "url",
 * then http://localhost:4321.
 *
 * Env:
 *   AGENT_OPS_PARENT_RUN_ID / AGENT_OPS_PARENT_AGENT_ID
 *                   run (and agent) that launched this session, for the workflow map
 *   AGENT_OPS_DEBUG=1  log errors to stderr
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_URL = "http://localhost:4321";
const DEBUG = process.env.AGENT_OPS_DEBUG === "1";
const MAX_STR = 2000;

// USD per million tokens [input, output]; cache reads ≈10% of input, cache writes ≈125%.
// Estimates only — keep in sync with src/lib/pricing.ts.
const PRICES = [
  [/fable|mythos/, 8, 40],
  [/opus-5-5/, 4, 20],
  [/opus/, 5, 25],
  [/sonnet/, 2, 10],
  [/haiku-5/, 0.1, 0.5],
  [/haiku/, 1, 5],
];

export function slug(s) {
  return String(s || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 100) || "unknown";
}

function clip(v) {
  if (v == null) return v;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > MAX_STR ? s.slice(0, MAX_STR) + `… [${s.length - MAX_STR} more chars]` : s;
}

function toolSummary(name, input) {
  if (!input || typeof input !== "object") return undefined;
  const v = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt;
  return typeof v === "string" ? v.replace(/\s+/g, " ").slice(0, 200) : undefined;
}

function isToolError(resp) {
  if (!resp || typeof resp !== "object") return false;
  return resp.is_error === true || resp.isError === true || (typeof resp.error === "string" && resp.error.length > 0) || resp.success === false;
}

/** Sum token usage from a Claude Code transcript (JSONL). */
export function usageFromTranscript(file) {
  const totals = { tokens_in: 0, tokens_out: 0, cost_usd: 0 };
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const seen = new Set();
  for (const line of text.split("\n")) {
    if (!line.includes('"usage"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const msg = o.message;
    const u = msg?.usage;
    if (!u) continue;
    const key = msg.id || o.uuid;
    if (key && seen.has(key)) continue; // streamed messages repeat usage per content block
    if (key) seen.add(key);
    const input = u.input_tokens || 0, cacheRead = u.cache_read_input_tokens || 0, cacheWrite = u.cache_creation_input_tokens || 0, out = u.output_tokens || 0;
    totals.tokens_in += input + cacheRead + cacheWrite;
    totals.tokens_out += out;
    const p = PRICES.find(([re]) => re.test(String(msg.model || ""))) ?? PRICES[1];
    totals.cost_usd += (input * p[1] + cacheRead * p[1] * 0.1 + cacheWrite * p[1] * 1.25 + out * p[2]) / 1e6;
  }
  totals.cost_usd = Math.round(totals.cost_usd * 10000) / 10000;
  return totals;
}

/** Finds .claude/agent-ops.json in `dir` or the nearest parent folder (written by `npm run register`). */
export function findAgentFile(dir) {
  let cur = dir ? path.resolve(dir) : null;
  for (let i = 0; cur && i < 40; i++) {
    const f = path.join(cur, ".claude", "agent-ops.json");
    try {
      if (fs.existsSync(f)) {
        const o = JSON.parse(fs.readFileSync(f, "utf8"));
        if (o && typeof o.agent_id === "string" && o.agent_id) return { ...o, file: f };
      }
    } catch {
      /* unreadable or invalid file: keep looking upward */
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/** --agent-id / --url from the hook command line. */
export function parseArgs(argv) {
  const get = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
  };
  return { agentId: get("--agent-id"), url: get("--url") };
}

/** Map a Claude Code hook payload to an Agent Ops event (or null to skip). */
export function toEvent(h, env = process.env, lookup = findAgentFile) {
  const name = h.hook_event_name;
  const file = env.AGENT_ID ? null : lookup(h.cwd || process.cwd());
  const agent_id = slug(env.AGENT_ID || file?.agent_id || path.basename(h.cwd || process.cwd()));
  const run_id = h.session_id || `cc-${Date.now()}`;
  const base = {
    schema_version: 1,
    agent_id,
    run_id,
    session_id: h.session_id,
    timestamp: new Date().toISOString(),
    source: "claude-code-hook",
    // Set these when one agent launches another, so the handoff shows on /workflow.
    ...(env.AGENT_OPS_PARENT_RUN_ID ? { parent_run_id: env.AGENT_OPS_PARENT_RUN_ID } : {}),
    ...(env.AGENT_OPS_PARENT_AGENT_ID ? { parent_agent_id: slug(env.AGENT_OPS_PARENT_AGENT_ID) } : {}),
  };
  switch (name) {
    case "SessionStart":
      return { ...base, event_type: "run_started", payload: { source: h.source, cwd: h.cwd, model: h.model } };
    case "UserPromptSubmit":
      return { ...base, event_type: "message", payload: { role: "user", text: clip(h.prompt) } };
    case "PreToolUse":
      return {
        ...base,
        event_type: "tool_called",
        payload: { tool: h.tool_name, summary: toolSummary(h.tool_name, h.tool_input), input: clip(h.tool_input), tool_use_id: h.tool_use_id },
      };
    case "PostToolUse": {
      const err = isToolError(h.tool_response);
      return {
        ...base,
        event_type: "tool_result",
        status: err ? "error" : "ok",
        payload: { tool: h.tool_name, output: clip(h.tool_response), tool_use_id: h.tool_use_id },
      };
    }
    case "PostToolUseFailure":
      return { ...base, event_type: "tool_result", status: "error", payload: { tool: h.tool_name, error: clip(h.error ?? h.tool_response) } };
    case "Notification":
      return { ...base, event_type: "message", payload: { role: "system", text: clip(h.message), kind: "notification" } };
    case "SubagentStop":
      return { ...base, event_type: "message", payload: { role: "system", text: "Subagent finished", kind: "subagent_stop" } };
    case "Stop":
    case "SessionEnd": {
      const usage = h.transcript_path ? usageFromTranscript(h.transcript_path) : null;
      return {
        ...base,
        event_type: "run_completed",
        status: "success",
        payload: { reason: name === "SessionEnd" ? h.reason || "session_end" : "turn_end" },
        ...(usage ? { metrics: usage, metrics_cumulative: true } : {}),
      };
    }
    default:
      return null;
  }
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const hook = JSON.parse(raw || "{}");
  const args = parseArgs(process.argv.slice(2));
  const env = args.agentId ? { ...process.env, AGENT_ID: args.agentId } : process.env;
  const event = toEvent(hook, env);
  if (!event) return;
  const fileUrl = env.AGENT_ID ? undefined : findAgentFile(hook.cwd || process.cwd())?.url;
  const base = (args.url || process.env.AGENT_OPS_URL || fileUrl || DEFAULT_URL).replace(/\/$/, "");
  await fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(1000),
  });
}

// fileURLToPath (not URL.pathname) so this also matches on Windows ("C:\\..." paths).
const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const hardStop = setTimeout(() => process.exit(0), 1500);
  main()
    .catch((e) => DEBUG && console.error("[agent-ops hook]", e?.message || e))
    .finally(() => {
      clearTimeout(hardStop);
      process.exit(0);
    });
}
