import fs from "node:fs";
import path from "node:path";
import type { AgentManifest } from "../registry/manifest";
import { isRunning, parseStreamLine as parse, runClaude, stopRun, type ClaudeChunk, type ParseState } from "../claude/run";

export type ChatChunk = ClaudeChunk;
export type { ParseState };
export const parseStreamLine = parse;

export type ChatAvailability =
  | { enabled: true; projectDir: string; permissionMode: string; instructions?: string; addDirs: string[] }
  | { enabled: false; reason: string };

/** The agent's standing instructions: the Claude task's SKILL.md body, else CLAUDE.md in its folder. */
export function agentInstructions(m: AgentManifest): string | undefined {
  if (m.origin?.instructions?.trim()) return m.origin.instructions;
  if (!m.project_dir) return undefined;
  try {
    const f = path.join(m.project_dir, "CLAUDE.md");
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

export function chatAvailability(manifest: AgentManifest | null | undefined): ChatAvailability {
  if (!manifest) return { enabled: false, reason: "Create a manifest for this agent first." };
  if (manifest.type !== "claude-code") return { enabled: false, reason: `Chat is available for claude-code agents (this one is "${manifest.type}").` };
  const dir = manifest.project_dir ?? manifest.origin?.taskDir;
  if (!dir) return { enabled: false, reason: "Set a working folder for this agent (Settings tab) to enable chat." };
  const addDirs = [...(manifest.origin ? [manifest.origin.taskDir] : []), ...manifest.extra_dirs];
  return {
    enabled: true,
    projectDir: dir,
    permissionMode: manifest.chat?.permission_mode ?? "default",
    instructions: manifest.origin?.instructions,
    addDirs,
  };
}

const key = (agentId: string) => `chat:${agentId}`;
export const isChatRunning = (agentId: string) => isRunning(key(agentId));
export const stopChat = (agentId: string) => stopRun(key(agentId));
export const claudeBin = () => process.env.AGENT_OPS_CLAUDE_BIN || "claude";

/** Background given to chat so it knows which agent it is talking as and where its files are. */
export function chatSystemPrompt(agentName: string, projectDir: string, instructions: string | undefined, addDirs: string[]): string {
  const parts = [
    `You are chatting with the owner of the agent "${agentName}" from the Agent Ops dashboard.`,
    `Answer questions about this agent, its work and its files. Its working folder is ${projectDir}.`,
  ];
  if (addDirs.length) parts.push(`You can also read these folders: ${addDirs.join(", ")}.`);
  parts.push("Use Read, Glob and Grep to look at files before answering questions about them. Say plainly when something isn't there.");
  if (instructions?.trim()) {
    const body = instructions.length > 20_000 ? instructions.slice(0, 20_000) + "\n…(truncated)" : instructions;
    parts.push("", "These are the agent's standing instructions (what it does when it runs). They are context, not a request to run them now:", "<agent_instructions>", body, "</agent_instructions>");
  }
  return parts.join("\n");
}

/**
 * Runs one chat turn with Claude Code in the agent's folder.
 * Reading and searching are pre-approved so file questions work without a person approving each read.
 */
export function runChatTurn(opts: {
  agentId: string;
  projectDir: string;
  permissionMode: string;
  message: string;
  resumeSessionId?: string | null;
  agentName?: string;
  instructions?: string;
  addDirs?: string[];
  onChunk: (c: ChatChunk) => void;
}): Promise<"done" | "error" | "stopped"> {
  const tools = ["Read", "Glob", "Grep", "LS"];
  if (opts.permissionMode === "acceptEdits") tools.push("Edit", "Write", "MultiEdit");
  return runClaude({
    key: key(opts.agentId),
    cwd: opts.projectDir,
    message: opts.message,
    permissionMode: opts.permissionMode,
    resumeSessionId: opts.resumeSessionId,
    appendSystemPrompt: opts.resumeSessionId ? undefined : chatSystemPrompt(opts.agentName ?? opts.agentId, opts.projectDir, opts.instructions, opts.addDirs ?? []),
    addDirs: opts.addDirs,
    allowedTools: tools,
    env: { AGENT_ID: opts.agentId },
    onChunk: opts.onChunk,
  });
}
