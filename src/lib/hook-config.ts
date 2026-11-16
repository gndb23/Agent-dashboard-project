import path from "node:path";

export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "SubagentStop",
  "Stop",
  "SessionEnd",
] as const;
const WITH_MATCHER = new Set(["PreToolUse", "PostToolUse"]);

export function hookScriptPath(root = process.cwd()) {
  return path.join(root, "integrations", "claude-code", "hook.mjs");
}

/**
 * The hook command line. Options are passed as arguments, not "VAR=x" prefixes,
 * so the same command works in cmd.exe, PowerShell and sh.
 */
export function hookCommand(opts: { root?: string; agentId?: string; url?: string } = {}) {
  const args = [
    opts.agentId ? `--agent-id ${opts.agentId}` : null,
    opts.url && opts.url !== "http://localhost:4321" ? `--url ${opts.url}` : null,
  ].filter(Boolean);
  return `node "${hookScriptPath(opts.root)}"${args.length ? " " + args.join(" ") : ""}`;
}

/** True when a hook command points at this project's hook script. */
export function isAgentOpsHookCommand(command: unknown): boolean {
  return typeof command === "string" && /integrations[\\/]+claude-code[\\/]+hook\.mjs/.test(command);
}

/** The `.claude/settings.json` hooks block, with the real absolute hook path filled in. */
export function claudeHookSettings(opts: { root?: string; agentId?: string; url?: string } = {}) {
  const command = hookCommand(opts);
  const hooks: Record<string, unknown[]> = {};
  for (const ev of HOOK_EVENTS) {
    hooks[ev] = [{ ...(WITH_MATCHER.has(ev) ? { matcher: "*" } : {}), hooks: [{ type: "command", command, timeout: 5 }] }];
  }
  return { hooks };
}
