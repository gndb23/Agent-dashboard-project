/**
 * One-step agent registration (used by `npm run register`).
 *
 * Creates or updates, in one go:
 *   - agents/<id>.yaml                    the manifest (validated before it is written)
 *   - <project>/                          the agent's project folder
 *   - <project>/CLAUDE.md                 the agent's instructions (never overwritten)
 *   - <project>/.claude/agent-ops.json    tells the hook which agent this folder belongs to
 *   - reporting hooks                     in ~/.claude/settings.json (all projects) or the project's settings
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CronExpressionParser } from "cron-parser";
import { parseManifest, AGENT_TYPES } from "./registry/manifest";
import { loadRegistry } from "./registry/registry";
import { HOOK_EVENTS, hookCommand, isAgentOpsHookCommand } from "./hook-config";

const WITH_MATCHER = new Set(["PreToolUse", "PostToolUse"]);
export const DEFAULT_URL = "http://localhost:4321";

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
}

export { scheduleToCron, type ScheduleResult } from "./schedule";

/** Hours of silence after which a scheduled agent counts as having missed a run. */
export function missedRunHours(cron: string, timezone?: string, from = new Date("2026-01-05T00:00:00Z")): number {
  const it = CronExpressionParser.parse(cron, { currentDate: from, tz: timezone });
  let prev = it.next().toDate().getTime();
  let maxGap = 0;
  for (let i = 0; i < 30; i++) {
    const next = it.next().toDate().getTime();
    maxGap = Math.max(maxGap, next - prev);
    prev = next;
  }
  const hours = maxGap / 3_600_000;
  return Math.max(1, Math.ceil(hours + Math.max(1, hours * 0.1)));
}

// ------------------------------------------------------------------ file contents

export type AgentType = (typeof AGENT_TYPES)[number];
export type PermissionMode = "default" | "plan" | "acceptEdits";

export type RegisterInput = {
  id: string;
  name: string;
  description?: string;
  type?: AgentType;
  projectDir: string;
  schedule?: string | null; // cron, already converted
  scheduleLabel?: string;
  timezone?: string;
  triggers?: string[];
  tags?: string[];
  permissionMode?: PermissionMode;
  /** Agent runs on this computer, so it can report runs → add a missed-run alert when scheduled. */
  reportsRuns?: boolean;
  instructions?: string;
  url?: string;
};

const q = (s: string) => JSON.stringify(s); // JSON strings are valid YAML scalars
const toYamlPath = (p: string) => p.replace(/\\/g, "/");

export function buildManifestYaml(i: RegisterInput): string {
  const type = i.type ?? "claude-code";
  const lines = [
    `# Registered with: npm run register`,
    `id: ${i.id}`,
    `name: ${q(i.name)}`,
    `description: ${q(i.description ?? "")}`,
    `owner: ""`,
    `type: ${type}`,
    `project_dir: ${q(toYamlPath(path.resolve(i.projectDir)))}`,
  ];
  if (i.schedule) {
    lines.push(`schedule: ${q(i.schedule)}${i.scheduleLabel ? `   # ${i.scheduleLabel}` : ""}`);
    if (i.timezone) lines.push(`timezone: ${i.timezone}`);
  }
  lines.push(`tags: [${(i.tags ?? []).map(slugify).filter(Boolean).join(", ")}]`);
  if (i.triggers?.length) lines.push(`triggers: [${i.triggers.join(", ")}]`);
  if (type === "claude-code" && i.permissionMode && i.permissionMode !== "default") {
    lines.push(`chat:`, `  permission_mode: ${i.permissionMode}`);
  }
  lines.push(`alert_rules:`, `  - type: consecutive_failures`, `    threshold: 2`);
  if (i.schedule) {
    const hours = missedRunHours(i.schedule, i.timezone);
    const rule = [`  - type: no_run_within`, `    hours: ${hours}`, `    severity: critical`];
    if (i.reportsRuns) lines.push(...rule);
    else lines.push(`  # Uncomment once this agent reports its runs (it doesn't run on this computer yet):`, ...rule.map((l) => `  #${l.slice(1)}`));
  }
  return lines.join("\n") + "\n";
}

export function buildClaudeMd(i: RegisterInput): string {
  const facts = [
    `- Agent id: \`${i.id}\` (runs in this folder are reported to the Agent Ops dashboard as this agent)`,
    `- Schedule: ${i.schedule ? `${i.scheduleLabel ?? i.schedule}${i.timezone ? ` (${i.timezone})` : ""}` : "on demand"}`,
  ];
  if (i.triggers?.length) facts.push(`- Hands work to: ${i.triggers.map((t) => `\`${t}\``).join(", ")}`);
  const body = i.instructions?.trim()
    ? i.instructions.trim()
    : "<!-- Write what this agent should do here: its goal, the steps it follows, where its inputs come from and where results go. Claude Code reads this file automatically in every session in this folder, including chats from the dashboard. -->";
  return [`# ${i.name}`, "", i.description?.trim() || "", "", ...facts, "", "## Instructions", "", body, ""].join("\n").replace(/\n{3,}/g, "\n\n");
}

// ------------------------------------------------------------------ settings.json merge

export type HookSettingsResult = { text: string; changed: boolean };

/**
 * Adds the Agent Ops hook to every hook event in a Claude Code settings.json, keeping
 * every other setting and every other hook. Idempotent: an existing Agent Ops entry
 * is replaced rather than duplicated. Throws if the existing file is not valid JSON.
 */
export function mergeHooksIntoSettings(existing: string | null, command: string): HookSettingsResult {
  let settings: Record<string, any> = {};
  if (existing && existing.trim()) {
    try {
      settings = JSON.parse(existing);
    } catch (e) {
      throw new Error(`settings.json is not valid JSON (${(e as Error).message}). Fix it first; it was left unchanged.`);
    }
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("settings.json must contain a JSON object.");
  }
  const before = JSON.stringify(settings);
  const hooks: Record<string, any[]> = settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {};
  for (const ev of HOOK_EVENTS) {
    const groups: any[] = Array.isArray(hooks[ev]) ? hooks[ev] : [];
    const cleaned = groups
      .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h: any) => !isAgentOpsHookCommand(h?.command)) } : g))
      .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0);
    cleaned.push({ ...(WITH_MATCHER.has(ev) ? { matcher: "*" } : {}), hooks: [{ type: "command", command, timeout: 5 }] });
    hooks[ev] = cleaned;
  }
  settings.hooks = hooks;
  return { text: JSON.stringify(settings, null, 2) + "\n", changed: JSON.stringify(settings) !== before };
}

/** True when a settings.json already sends every hook event to Agent Ops. */
export function hasAgentOpsHooks(text: string | null): boolean {
  if (!text) return false;
  try {
    const s = JSON.parse(text);
    return HOOK_EVENTS.every((ev) =>
      (s?.hooks?.[ev] ?? []).some((g: any) => (g?.hooks ?? []).some((h: any) => isAgentOpsHookCommand(h?.command))),
    );
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ the whole thing

export type Action = { path: string; action: "created" | "updated" | "kept" | "backed up"; note?: string };

export type RegisterOptions = {
  agentsDir: string;
  dashboardRoot: string;
  homeDir?: string;
  /** "global": hooks in ~/.claude/settings.json (all projects); "project": only this project; "none": skip. */
  hooks: "global" | "project" | "none";
  force?: boolean;
};

const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);

function writeWithBackup(file: string, text: string, actions: Action[]) {
  const old = read(file);
  if (old === text) {
    actions.push({ path: file, action: "kept", note: "already up to date" });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (old !== null) {
    const bak = `${file}.bak`;
    fs.writeFileSync(bak, old);
    actions.push({ path: bak, action: "backed up" });
  }
  fs.writeFileSync(file, text);
  actions.push({ path: file, action: old === null ? "created" : "updated" });
}

export function validateInput(i: RegisterInput, agentsDir: string): string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(i.id)) errors.push(`Agent id "${i.id}" must be lowercase letters, digits, ".", "_" or "-".`);
  if (!i.name.trim()) errors.push("Name is required.");
  if (!path.isAbsolute(i.projectDir)) errors.push(`Project folder must be a full path (got "${i.projectDir}").`);
  const known = new Set(loadRegistry(agentsDir).agents.map((a) => a.id));
  for (const t of i.triggers ?? []) {
    if (t === i.id) errors.push("An agent can't trigger itself.");
    else if (!known.has(t)) errors.push(`"${t}" in hands-work-to isn't a registered agent. Register it first, or leave it out.`);
  }
  if (i.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: i.timezone });
    } catch {
      errors.push(`Unknown time zone "${i.timezone}" (use names like Asia/Singapore).`);
    }
  }
  return errors;
}

export function registerAgent(i: RegisterInput, o: RegisterOptions): Action[] {
  const errors = validateInput(i, o.agentsDir);
  if (errors.length) throw new Error(errors.join("\n"));

  const manifestFile = path.join(o.agentsDir, `${i.id}.yaml`);
  if (fs.existsSync(manifestFile) && !o.force) {
    throw new Error(`agents/${i.id}.yaml already exists. Re-run with --force to replace it (a .bak copy is kept).`);
  }
  const yaml = buildManifestYaml(i);
  const parsed = parseManifest(yaml, `${i.id}.yaml`);
  if (!parsed.ok) throw new Error(`Generated manifest is invalid:\n${parsed.error}`);

  const actions: Action[] = [];
  const projectDir = path.resolve(i.projectDir);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
    actions.push({ path: projectDir, action: "created" });
  } else {
    actions.push({ path: projectDir, action: "kept", note: "folder already existed" });
  }

  const claudeMd = path.join(projectDir, "CLAUDE.md");
  if (fs.existsSync(claudeMd)) actions.push({ path: claudeMd, action: "kept", note: "existing instructions were not touched" });
  else {
    fs.writeFileSync(claudeMd, buildClaudeMd(i));
    actions.push({ path: claudeMd, action: "created" });
  }

  const agentFile = path.join(projectDir, ".claude", "agent-ops.json");
  writeWithBackup(agentFile, JSON.stringify({ agent_id: i.id, url: i.url ?? DEFAULT_URL }, null, 2) + "\n", actions);

  const command = hookCommand({ root: o.dashboardRoot, url: i.url });
  if (o.hooks !== "none") {
    const settingsFile =
      o.hooks === "global"
        ? path.join(o.homeDir ?? os.homedir(), ".claude", "settings.json")
        : path.join(projectDir, ".claude", "settings.json");
    const merged = mergeHooksIntoSettings(read(settingsFile), command);
    if (merged.changed) writeWithBackup(settingsFile, merged.text, actions);
    else actions.push({ path: settingsFile, action: "kept", note: "reporting hooks already installed" });
  }

  writeWithBackup(manifestFile, yaml, actions);
  return actions;
}
