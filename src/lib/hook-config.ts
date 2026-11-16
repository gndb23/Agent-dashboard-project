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

/** The `.claude/settings.json` hooks block, with the real absolute hook path filled in. */
export function claudeHookSettings(opts: { root?: string; agentId?: string; url?: string } = {}) {
  const envPrefix = [
    opts.agentId ? `AGENT_ID=${opts.agentId}` : null,
    opts.url && opts.url !== "http://localhost:4321" ? `AGENT_OPS_URL=${opts.url}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const command = `${envPrefix ? envPrefix + " " : ""}node "${hookScriptPath(opts.root)}"`;
  const hooks: Record<string, unknown[]> = {};
  for (const ev of HOOK_EVENTS) {
    hooks[ev] = [{ ...(WITH_MATCHER.has(ev) ? { matcher: "*" } : {}), hooks: [{ type: "command", command, timeout: 5 }] }];
  }
  return { hooks };
}
