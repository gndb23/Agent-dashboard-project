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
 * Env:
 *   AGENT_OPS_URL   dashboard base URL (default http://localhost:4321)
 *   AGENT_ID        agent id (default: slug of the project folder name)
 *   AGENT_OPS_PARENT_RUN_ID / AGENT_OPS_PARENT_AGENT_ID
 *                   run (and agent) that launched this session, for the workflow map
 *   AGENT_OPS_DEBUG=1  log errors to stderr
 */
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.AGENT_OPS_URL || "http://localhost:4321").replace(/\/$/, "");
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

/** Map a Claude Code hook payload to an Agent Ops event (or null to skip). */
export function toEvent(h, env = process.env) {
  const name = h.hook_event_name;
  const agent_id = slug(env.AGENT_ID || path.basename(h.cwd || process.cwd()));
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
  const event = toEvent(hook);
  if (!event) return;
  await fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(1000),
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const hardStop = setTimeout(() => process.exit(0), 1500);
  main()
    .catch((e) => DEBUG && console.error("[agent-ops hook]", e?.message || e))
    .finally(() => {
      clearTimeout(hardStop);
      process.exit(0);
    });
}
