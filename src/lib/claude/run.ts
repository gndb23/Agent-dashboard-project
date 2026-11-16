import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Shared runner for the Claude Code CLI (`claude -p --output-format stream-json`).
 * Used by agent chat, "Ask Agent Ops" and "Run now".
 */

export type ClaudeChunk =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary?: string; input?: unknown; id?: string }
  | { type: "tool_result"; toolUseId?: string; isError: boolean; output?: string }
  | { type: "result"; isError: boolean; costUsd?: number; text?: string; usage?: { input: number; output: number }; durationMs?: number }
  | { type: "error"; message: string }
  | { type: "done"; status: "done" | "error" | "stopped" };

export type ParseState = { sawDeltas: boolean };

export function toolSummary(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  const v = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt;
  return typeof v === "string" ? v.replace(/\s+/g, " ").slice(0, 160) : undefined;
}

/** Parses one line of stream-json output. Tolerant: unknown or malformed lines give no chunks. */
export function parseStreamLine(line: string, state: ParseState): ClaudeChunk[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return [];
  let o: Record<string, any>;
  try {
    o = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const out: ClaudeChunk[] = [];
  switch (o.type) {
    case "system":
      if (o.subtype === "init" && typeof o.session_id === "string") out.push({ type: "session", sessionId: o.session_id });
      break;
    case "stream_event": {
      const ev = o.event;
      if (o.parent_tool_use_id) break;
      if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") {
        state.sawDeltas = true;
        out.push({ type: "text", text: ev.delta.text });
      } else if (ev?.type === "message_start" && state.sawDeltas) {
        out.push({ type: "text", text: "\n\n" });
      }
      break;
    }
    case "assistant": {
      if (o.parent_tool_use_id) break; // subagent chatter
      const content = Array.isArray(o.message?.content) ? o.message.content : [];
      for (const b of content) {
        if (b?.type === "text" && typeof b.text === "string" && !state.sawDeltas) out.push({ type: "text", text: b.text + "\n\n" });
        if (b?.type === "tool_use" && typeof b.name === "string") out.push({ type: "tool", name: b.name, summary: toolSummary(b.input), input: b.input, id: b.id });
      }
      break;
    }
    case "user": {
      if (o.parent_tool_use_id) break;
      const content = Array.isArray(o.message?.content) ? o.message.content : [];
      for (const b of content) {
        if (b?.type === "tool_result") {
          const body = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
          out.push({ type: "tool_result", toolUseId: b.tool_use_id, isError: Boolean(b.is_error), output: body.slice(0, 2000) });
        }
      }
      break;
    }
    case "result": {
      const u = o.usage ?? {};
      out.push({
        type: "result",
        isError: Boolean(o.is_error) || (typeof o.subtype === "string" && o.subtype !== "success"),
        costUsd: typeof o.total_cost_usd === "number" ? o.total_cost_usd : undefined,
        text: typeof o.result === "string" ? o.result : undefined,
        usage: {
          input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          output: u.output_tokens ?? 0,
        },
        durationMs: typeof o.duration_ms === "number" ? o.duration_ms : undefined,
      });
      if (typeof o.session_id === "string") out.push({ type: "session", sessionId: o.session_id });
      break;
    }
  }
  return out;
}

// ------------------------------------------------------------------ locating the CLI

export type ClaudeCommand = { command: string; prefixArgs: string[]; source: string };

function exists(p: string) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** For an npm "claude.cmd" shim, the Node script it wraps (so we can run it without a shell). */
function npmShimScript(shimDir: string): string | null {
  for (const rel of ["node_modules/@anthropic-ai/claude-code/cli.js", "node_modules/@anthropic-ai/claude-code/cli.mjs"]) {
    const p = path.join(shimDir, rel);
    if (exists(p)) return p;
  }
  return null;
}

/**
 * Finds the Claude Code CLI. Order: AGENT_OPS_CLAUDE_BIN, then PATH, then the usual install folders.
 * On Windows, `.cmd`/`.bat` shims can't be spawned without a shell (unsafe with arbitrary arguments),
 * so the npm shim is resolved to `node cli.js` instead.
 */
export function resolveClaude(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): ClaudeCommand | null {
  const override = env.AGENT_OPS_CLAUDE_BIN;
  const win = platform === "win32";
  const fromFile = (file: string, source: string): ClaudeCommand | null => {
    if (!exists(file)) return null;
    if (win && /\.(cmd|bat)$/i.test(file)) {
      const script = npmShimScript(path.dirname(file));
      return script ? { command: process.execPath, prefixArgs: [script], source } : null;
    }
    if (/\.(mjs|cjs|js)$/i.test(file)) return { command: process.execPath, prefixArgs: [file], source };
    return { command: file, prefixArgs: [], source };
  };
  if (override) return fromFile(override, "AGENT_OPS_CLAUDE_BIN") ?? (exists(override) ? null : { command: override, prefixArgs: [], source: "AGENT_OPS_CLAUDE_BIN" });

  const names = win ? ["claude.exe", "claude.cmd", "claude.bat", "claude"] : ["claude"];
  const sep = win ? ";" : ":";
  const pathVar = env.PATH ?? env.Path ?? "";
  for (const dir of pathVar.split(sep).filter(Boolean)) {
    for (const n of names) {
      const r = fromFile(path.join(dir.replace(/^"|"$/g, ""), n), "PATH");
      if (r) return r;
    }
  }
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const extra = win
    ? [
        path.join(home, ".local", "bin", "claude.exe"),
        path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Programs", "claude", "claude.exe"),
        path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "npm", "claude.cmd"),
        path.join(home, ".claude", "local", "claude.exe"),
      ]
    : [path.join(home, ".local", "bin", "claude"), path.join(home, ".claude", "local", "claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"];
  for (const f of extra) {
    const r = fromFile(f, "default install location");
    if (r) return r;
  }
  return null;
}

// ------------------------------------------------------------------ running

type Active = { child: ChildProcess; stopped: boolean; timedOut: boolean };
const g = globalThis as unknown as { __agentOpsClaude?: Map<string, Active> };
const active = () => (g.__agentOpsClaude ??= new Map());

export const isRunning = (key: string) => active().has(key);

export function stopRun(key: string): boolean {
  const a = active().get(key);
  if (!a) return false;
  a.stopped = true;
  a.child.kill("SIGTERM");
  setTimeout(() => a.child.exitCode === null && a.child.kill("SIGKILL"), 3000).unref();
  return true;
}

export type RunClaudeOptions = {
  /** Only one process per key at a time (e.g. "chat:<agent>", "run:<agent>", "ask"). */
  key: string;
  cwd: string;
  message: string;
  permissionMode?: string;
  resumeSessionId?: string | null;
  /** Written to a temp file and passed with --append-system-prompt-file. */
  appendSystemPrompt?: string;
  addDirs?: string[];
  allowedTools?: string[];
  model?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  onChunk: (c: ClaudeChunk) => void;
};

export type RunStatus = "done" | "error" | "stopped";

function tempDir() {
  const d = path.join(process.env.AGENT_OPS_DATA_DIR ?? path.join(process.cwd(), "data"), "tmp");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Runs one turn of Claude Code. The message goes on stdin, never through a shell. */
export function runClaude(o: RunClaudeOptions): Promise<RunStatus> {
  return new Promise((resolve) => {
    const fail = (message: string) => {
      o.onChunk({ type: "error", message });
      o.onChunk({ type: "done", status: "error" });
      resolve("error");
    };
    if (active().has(o.key)) return fail("This agent is already busy. Wait for it to finish or press Stop.");
    if (!fs.existsSync(o.cwd)) return fail(`Working folder does not exist: ${o.cwd}`);
    const bin = resolveClaude();
    if (!bin) {
      return fail(
        "Claude Code isn't installed on this computer (or can't be found). Install it from claude.com/claude-code, then reopen the dashboard. If it's installed somewhere unusual, set AGENT_OPS_CLAUDE_BIN to its full path.",
      );
    }

    const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
    if (o.permissionMode) args.push("--permission-mode", o.permissionMode);
    if (o.resumeSessionId) args.push("--resume", o.resumeSessionId);
    if (o.model) args.push("--model", o.model);
    let promptFile: string | null = null;
    if (o.appendSystemPrompt?.trim()) {
      promptFile = path.join(tempDir(), `prompt-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
      fs.writeFileSync(promptFile, o.appendSystemPrompt);
      args.push("--append-system-prompt-file", promptFile);
    }
    const dirs = [...new Set((o.addDirs ?? []).filter((d) => d && fs.existsSync(d) && path.resolve(d) !== path.resolve(o.cwd)))];
    if (dirs.length) args.push("--add-dir", ...dirs);
    if (o.allowedTools?.length) args.push("--allowedTools", o.allowedTools.join(","));

    let child: ChildProcess;
    try {
      child = spawn(bin.command, [...bin.prefixArgs, ...args], {
        cwd: o.cwd,
        env: { ...process.env, ...o.env },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      return fail(`Could not start Claude Code: ${(e as Error).message}`);
    }
    const entry: Active = { child, stopped: false, timedOut: false };
    active().set(o.key, entry);
    const timer = o.timeoutMs
      ? setTimeout(() => {
          entry.timedOut = true;
          stopRun(o.key);
        }, o.timeoutMs)
      : null;

    const state: ParseState = { sawDeltas: false };
    let buf = "";
    let stderr = "";
    let sawResult = false;
    let resultError = false;
    let sawText = false;
    let allText = "";
    let settled = false;
    const finish = (status: RunStatus) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      active().delete(o.key);
      if (promptFile) fs.rm(promptFile, { force: true }, () => {});
      o.onChunk({ type: "done", status });
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
          // Don't show the same error twice when it was already streamed as the reply ("Not logged in").
          if (c.text && c.isError && !allText.includes(c.text.trim())) o.onChunk({ type: "error", message: c.text });
          else if (c.text && !c.isError && !sawText) o.onChunk({ type: "text", text: c.text });
        }
        o.onChunk(c);
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
      o.onChunk({
        type: "error",
        message: e.code === "ENOENT" ? `Claude Code CLI not found ("${bin.command}"). Install it, or set AGENT_OPS_CLAUDE_BIN to its full path.` : `Could not start Claude Code: ${e.message}`,
      });
      finish("error");
    });
    child.on("close", (code) => {
      if (buf.trim()) handle(buf);
      if (entry.timedOut) {
        o.onChunk({ type: "error", message: `Stopped after ${Math.round((o.timeoutMs ?? 0) / 60000)} minutes (time limit).` });
        return finish("error");
      }
      if (entry.stopped) return finish("stopped");
      if (code !== 0 && !sawResult) {
        const msg = stderr.trim() || `Claude Code exited with code ${code}`;
        o.onChunk({ type: "error", message: /not logged in|please run \/login|authenticat/i.test(msg) ? `${msg}\n\nLog in once: Settings → Health → "Log in to Claude".` : msg });
      }
      finish(code === 0 && !resultError ? "done" : "error");
    });
    child.stdin!.on("error", () => {});
    child.stdin!.end(o.message);
  });
}
