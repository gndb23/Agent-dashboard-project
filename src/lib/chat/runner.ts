import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import type { AgentManifest } from "../registry/manifest";

/** One piece of a streamed reply, sent to the browser as an NDJSON line. */
export type ChatChunk =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary?: string }
  | { type: "result"; isError: boolean; costUsd?: number; text?: string }
  | { type: "error"; message: string }
  | { type: "done"; status: "done" | "error" | "stopped" };

export type ParseState = { sawDeltas: boolean };

function toolSummary(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  const v = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt;
  return typeof v === "string" ? v.replace(/\s+/g, " ").slice(0, 160) : undefined;
}

/**
 * Parses one line of `claude -p --output-format stream-json` output.
 * Tolerant by design: unknown or malformed lines produce no chunks.
 */
export function parseStreamLine(line: string, state: ParseState): ChatChunk[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return [];
  let o: Record<string, any>;
  try {
    o = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const out: ChatChunk[] = [];
  switch (o.type) {
    case "system":
      if (o.subtype === "init" && typeof o.session_id === "string") out.push({ type: "session", sessionId: o.session_id });
      break;
    case "stream_event": {
      const ev = o.event;
      if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") {
        state.sawDeltas = true;
        out.push({ type: "text", text: ev.delta.text });
      } else if (ev?.type === "message_start" && state.sawDeltas) {
        out.push({ type: "text", text: "\n\n" }); // separate text of successive assistant messages
      }
      break;
    }
    case "assistant": {
      if (o.parent_tool_use_id) break; // subagent chatter
      const content = Array.isArray(o.message?.content) ? o.message.content : [];
      for (const b of content) {
        if (b?.type === "text" && typeof b.text === "string" && !state.sawDeltas) out.push({ type: "text", text: b.text + "\n\n" });
        if (b?.type === "tool_use" && typeof b.name === "string") out.push({ type: "tool", name: b.name, summary: toolSummary(b.input) });
      }
      break;
    }
    case "result":
      out.push({
        type: "result",
        isError: Boolean(o.is_error) || (typeof o.subtype === "string" && o.subtype !== "success"),
        costUsd: typeof o.total_cost_usd === "number" ? o.total_cost_usd : undefined,
        text: typeof o.result === "string" ? o.result : undefined,
      });
      if (typeof o.session_id === "string") out.push({ type: "session", sessionId: o.session_id });
      break;
  }
  return out;
}

export type ChatAvailability = { enabled: true; projectDir: string; permissionMode: string } | { enabled: false; reason: string };

export function chatAvailability(manifest: AgentManifest | null | undefined): ChatAvailability {
  if (!manifest) return { enabled: false, reason: "Create a manifest for this agent first." };
  if (manifest.type !== "claude-code") return { enabled: false, reason: `Chat is available for claude-code agents (this one is "${manifest.type}").` };
  if (!manifest.project_dir) return { enabled: false, reason: "Add project_dir (the absolute path of the agent's project) to the manifest to enable chat." };
  return { enabled: true, projectDir: manifest.project_dir, permissionMode: manifest.chat?.permission_mode ?? "default" };
}

type Active = { child: ChildProcess; stopped: boolean };
const g = globalThis as unknown as { __agentOpsChats?: Map<string, Active> };
const active = () => (g.__agentOpsChats ??= new Map());

export function isChatRunning(agentId: string) {
  return active().has(agentId);
}

export function stopChat(agentId: string): boolean {
  const a = active().get(agentId);
  if (!a) return false;
  a.stopped = true;
  a.child.kill("SIGTERM");
  setTimeout(() => a.child.exitCode === null && a.child.kill("SIGKILL"), 3000).unref();
  return true;
}

export function claudeBin() {
  return process.env.AGENT_OPS_CLAUDE_BIN || "claude";
}

/**
 * Runs one chat turn with Claude Code in the agent's project folder.
 * The message is sent on stdin (never interpolated into a shell command).
 * Resolves when the process exits; `onChunk` receives the streamed reply.
 */
export function runChatTurn(opts: {
  agentId: string;
  projectDir: string;
  permissionMode: string;
  message: string;
  resumeSessionId?: string | null;
  onChunk: (c: ChatChunk) => void;
}): Promise<"done" | "error" | "stopped"> {
  return new Promise((resolve) => {
    const fail = (message: string) => {
      opts.onChunk({ type: "error", message });
      opts.onChunk({ type: "done", status: "error" });
      resolve("error");
    };
    if (active().has(opts.agentId)) return fail("This agent is already answering a message. Wait for it to finish or press Stop.");
    if (!fs.existsSync(opts.projectDir)) return fail(`project_dir does not exist: ${opts.projectDir}`);

    const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", opts.permissionMode];
    if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);

    let child: ChildProcess;
    try {
      child = spawn(claudeBin(), args, {
        cwd: opts.projectDir,
        env: { ...process.env, AGENT_ID: opts.agentId },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      return fail(`Could not start Claude Code: ${(e as Error).message}`);
    }
    const entry: Active = { child, stopped: false };
    active().set(opts.agentId, entry);

    const state: ParseState = { sawDeltas: false };
    let buf = "";
    let stderr = "";
    let sawResult = false;
    let resultError = false;
    let sawText = false;
    let allText = "";
    let settled = false;
    const finish = (status: "done" | "error" | "stopped") => {
      if (settled) return;
      settled = true;
      active().delete(opts.agentId);
      opts.onChunk({ type: "done", status });
      resolve(status);
    };
    const handle = (line: string) => {
      for (const c of parseStreamLine(line, state)) {
        if (c.type === "text") {
          sawText = true;
          allText += c.text;
        }
        if (c.type === "result") {
          sawResult = true;
          resultError = c.isError;
          // Some failures only carry their explanation in the result text. Skip it when the
          // same message was already streamed as the reply (e.g. "Not logged in"), so it isn't shown twice.
          if (c.text && c.isError && !allText.includes(c.text.trim())) opts.onChunk({ type: "error", message: c.text });
          else if (c.text && !c.isError && !sawText) opts.onChunk({ type: "text", text: c.text });
        }
        opts.onChunk(c);
      }
    };
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (d: string) => {
      buf += d;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (d: string) => (stderr = (stderr + d).slice(-2000)));
    child.on("error", (e: NodeJS.ErrnoException) => {
      opts.onChunk({
        type: "error",
        message:
          e.code === "ENOENT"
            ? `Claude Code CLI not found ("${claudeBin()}"). Install it, or set AGENT_OPS_CLAUDE_BIN to its full path.`
            : `Could not start Claude Code: ${e.message}`,
      });
      finish("error");
    });
    child.on("close", (code) => {
      if (buf.trim()) handle(buf);
      if (entry.stopped) return finish("stopped");
      if (code !== 0 && !sawResult) opts.onChunk({ type: "error", message: stderr.trim() || `Claude Code exited with code ${code}` });
      finish(code === 0 && !resultError ? "done" : "error");
    });
    child.stdin!.on("error", () => {});
    child.stdin!.end(opts.message);
  });
}
