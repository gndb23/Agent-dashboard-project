import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentManifest } from "../registry/manifest";
import { isRunning, runClaude, stopRun, type ClaudeChunk } from "../claude/run";
import { handleIncomingEvents } from "../service";
import { dataDir } from "../settings";

export const runKey = (agentId: string) => `run:${agentId}`;
export const isAgentRunning = (agentId: string) => isRunning(runKey(agentId));
export const stopAgentRun = (agentId: string) => stopRun(runKey(agentId));

/** Folder an agent runs in: its project folder, else its Claude task folder, else a private work folder. */
export function workFolder(m: AgentManifest): string {
  if (m.project_dir && fs.existsSync(m.project_dir)) return m.project_dir;
  if (m.origin?.taskDir && fs.existsSync(m.origin.taskDir)) return m.origin.taskDir;
  const d = path.join(dataDir(), "work", m.id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const PERMISSION_MAP: Record<string, string> = {
  default: "default", ask: "default", plan: "plan", acceptedits: "acceptEdits", accept_edits: "acceptEdits",
  auto: "auto", bypasspermissions: "bypassPermissions", bypass: "bypassPermissions",
};

export function runPermissionMode(m: AgentManifest): string {
  const fromTask = m.origin?.permissionMode ? PERMISSION_MAP[m.origin.permissionMode.toLowerCase().replace(/[\s-]/g, "")] : undefined;
  return m.run?.permission_mode ?? fromTask ?? "acceptEdits";
}

export function runPrompt(m: AgentManifest): string {
  if (m.run?.prompt?.trim()) return m.run.prompt;
  if (m.origin) return "Run your scheduled task now, following your instructions exactly. When you finish, give a short summary of what you did.";
  return "Do your job now, as described in your instructions (CLAUDE.md). When you finish, give a short summary of what you did.";
}

type Trigger = "manual" | "schedule";

/**
 * Starts an agent run in the background and records it as a normal run
 * (run_started → tools → run_completed with cost), so it shows up live everywhere.
 */
export function startAgentRun(m: AgentManifest, trigger: Trigger = "manual"): { runId: string } | { error: string } {
  if (m.type !== "claude-code") return { error: `Only claude-code agents can be run from the dashboard (this one is "${m.type}").` };
  if (isAgentRunning(m.id)) return { error: "This agent is already running." };
  const runId = `dash-${randomUUID()}`;
  const cwd = workFolder(m);
  const instructions = m.origin ? m.origin.instructions : undefined; // CLAUDE.md is loaded by Claude Code itself
  const base = { schema_version: 1, agent_id: m.id, run_id: runId, source: "dashboard-run" } as const;
  let seq = 0;
  const send = (e: Record<string, unknown>) => handleIncomingEvents({ ...base, event_id: `${runId}:${seq++}`, timestamp: new Date().toISOString(), ...e });

  send({ event_type: "run_started", payload: { title: trigger === "schedule" ? `Scheduled run of ${m.name}` : `Run now: ${m.name}`, trigger, cwd } });
  let text = "";
  let costUsd: number | undefined;
  let usage: { input: number; output: number } | undefined;
  let sessionId: string | undefined;
  let lastError: string | undefined;
  const toolNames = new Map<string, string>();

  const onChunk = (c: ClaudeChunk) => {
    switch (c.type) {
      case "session":
        sessionId = c.sessionId;
        break;
      case "text":
        text += c.text;
        break;
      case "tool":
        if (c.id) toolNames.set(c.id, c.name);
        send({ event_type: "tool_called", payload: { tool: c.name, summary: c.summary } });
        break;
      case "tool_result":
        send({ event_type: "tool_result", status: c.isError ? "error" : "ok", payload: { tool: (c.toolUseId && toolNames.get(c.toolUseId)) || "tool", output: c.output?.slice(0, 1000) } });
        break;
      case "result":
        costUsd = c.costUsd;
        usage = c.usage;
        break;
      case "error":
        lastError = c.message;
        send({ event_type: "error", payload: { message: c.message } });
        break;
      case "done": {
        const status = c.status === "done" ? "success" : c.status === "stopped" ? "cancelled" : "failed";
        const summary = text.trim().replace(/\n{3,}/g, "\n\n");
        send({
          event_type: "run_completed",
          status,
          session_id: sessionId,
          payload: { reason: c.status === "stopped" ? "stopped from dashboard" : lastError ? "error" : "finished", summary: summary.slice(-4000), text: summary.slice(0, 300) || undefined },
          metrics: { ...(usage ? { tokens_in: usage.input, tokens_out: usage.output } : {}), ...(costUsd !== undefined ? { cost_usd: costUsd } : {}) },
          metrics_cumulative: true,
        });
        break;
      }
    }
  };

  void runClaude({
    key: runKey(m.id),
    cwd,
    message: runPrompt(m),
    permissionMode: runPermissionMode(m),
    appendSystemPrompt: instructions
      ? `You are the agent "${m.name}", running from the Agent Ops dashboard.\n\nYour instructions:\n<agent_instructions>\n${instructions}\n</agent_instructions>`
      : undefined,
    addDirs: [...(m.origin ? [m.origin.taskDir] : []), ...m.extra_dirs],
    allowedTools: ["Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch", "TodoWrite"],
    model: m.run?.model ?? m.origin?.model,
    env: { AGENT_ID: m.id, AGENT_OPS_SKIP_HOOK: "1" },
    timeoutMs: (m.run?.max_minutes ?? 30) * 60_000,
    onChunk,
  });
  return { runId };
}
