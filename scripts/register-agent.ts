/**
 * Register a new agent and set up everything it needs, in one go.
 *
 *   npm run register                       # asks a few questions
 *   npm run register -- --id x --name "X" --schedule "daily 05:30" --yes
 *
 * Creates: agents/<id>.yaml, the project folder, CLAUDE.md (instructions),
 * .claude/agent-ops.json (labels runs from that folder), and installs the
 * reporting hooks if they aren't installed yet. Existing files are backed up
 * (*.bak) before being changed; an existing CLAUDE.md is never overwritten.
 *
 * Flags (all optional; anything missing is asked for unless --yes):
 *   --id <id>  --name <name>  --description <text>  --type claude-code|api-script|other
 *   --dir <project folder>  --schedule <"daily 05:30" | "weekdays 08:00" | "every 30m" | cron | none>
 *   --timezone <IANA>  --triggers <id,id>  --tags <a,b>  --instructions <file>
 *   --chat default|plan|acceptEdits  --remote (doesn't run on this computer)
 *   --hooks global|project|none  --force (replace an existing manifest)  --yes (accept defaults)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { agentsDir } from "../src/lib/registry/registry";
import { loadRegistry } from "../src/lib/registry/registry";
import {
  DEFAULT_URL, hasAgentOpsHooks, registerAgent, scheduleToCron, slugify, validateInput,
  type AgentType, type PermissionMode, type RegisterInput,
} from "../src/lib/register";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
};
const YES = flag("yes") || flag("y");

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

// Line reader that queues input, so answers typed (or piped) ahead of a question aren't lost.
let rl: readline.Interface | null = null;
const queued: string[] = [];
const waiting: ((line: string | null) => void)[] = [];
let closed = false;
function nextLine(): Promise<string | null> {
  if (!rl) {
    rl = readline.createInterface({ input: stdin, terminal: Boolean(stdin.isTTY) });
    rl.on("line", (l) => (waiting.length ? waiting.shift()!(l) : queued.push(l)));
    rl.on("close", () => {
      closed = true;
      while (waiting.length) waiting.shift()!(null);
    });
  }
  if (queued.length) return Promise.resolve(queued.shift()!);
  if (closed) return Promise.resolve(null);
  return new Promise((r) => waiting.push(r));
}

async function ask(question: string, def = "", validate?: (v: string) => string | null): Promise<string> {
  if (YES) {
    const err = validate?.(def);
    if (err) throw new Error(`${question}: ${err}`);
    return def;
  }
  for (;;) {
    stdout.write(`${c.bold(question)}${def ? c.dim(` [${def}]`) : ""}: `);
    const line = await nextLine();
    if (line === null) throw new Error("Input ended before all questions were answered.");
    if (!stdin.isTTY) stdout.write(`${line}\n`);
    const answer = line.trim() || def;
    const err = validate?.(answer);
    if (!err) return answer;
    console.log(c.red(`  ${err}`));
  }
}
async function confirm(question: string, def = true): Promise<boolean> {
  const a = (await ask(`${question} (${def ? "Y/n" : "y/N"})`, def ? "y" : "n")).toLowerCase();
  return a.startsWith("y");
}
const oneOf = (values: readonly string[]) => (v: string) => (values.includes(v) ? null : `Choose one of: ${values.join(", ")}`);

async function main() {
  if (flag("help") || flag("h")) {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
    console.log(src.slice(src.indexOf("/**") + 3, src.indexOf("*/")).replace(/^ \* ?/gm, "").trim());
    return;
  }
  const dir = agentsDir();
  const known = loadRegistry(dir).agents.map((a) => a.id);
  console.log(`\n${c.bold("Register an agent")} ${c.dim("· press Enter to accept the [default]")}\n`);

  const name = opt("name") ?? (await ask("Agent name", "", (v) => (v ? null : "A name is required.")));
  const id = opt("id") ?? (await ask("Agent id (used in files and events)", slugify(name), (v) =>
    /^[a-z0-9][a-z0-9._-]*$/.test(v) ? null : "Lowercase letters, digits, '.', '_' or '-' only."));
  const existing = fs.existsSync(path.join(dir, `${id}.yaml`));
  let force = flag("force");
  if (existing && !force) {
    force = await confirm(`agents/${id}.yaml already exists. Replace it? A .bak copy is kept`, false);
    if (!force) return console.log("Nothing changed.");
  }
  const description = opt("description") ?? (await ask("What does it do? (one line)", ""));
  const type = (opt("type") ?? (await ask("Type (claude-code, api-script, other)", "claude-code", oneOf(["claude-code", "api-script", "other"])))) as AgentType;
  const defaultDir = path.join(os.homedir(), "agents", id);
  const projectDir = path.resolve(opt("dir") ?? (await ask("Project folder (created if missing)", defaultDir, (v) =>
    path.isAbsolute(v) ? null : "Use a full path, e.g. C:\\Users\\you\\agents\\my-agent")));

  console.log(c.dim('  Schedule examples: "daily 05:30", "weekdays 08:00", "every 30m", "every 2h", a cron like "0 5 * * *", or blank for on demand'));
  const scheduleRaw = opt("schedule") ?? (await ask("Schedule", "", (v) => ("error" in scheduleToCron(v) ? (scheduleToCron(v) as { error: string }).error : null)));
  const sched = scheduleToCron(scheduleRaw) as { cron: string | null; label: string };
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const timezone = sched.cron ? opt("timezone") ?? (await ask("Time zone", localTz)) : undefined;

  if (known.length) console.log(c.dim(`  Registered agents: ${known.join(", ")}`));
  const triggersRaw = opt("triggers") ?? (await ask("Hands work to which agents? (comma-separated ids, blank for none)", "", (v) => {
    const bad = v.split(",").map((s) => s.trim()).filter((s) => s && !known.includes(s));
    return bad.length ? `Not registered: ${bad.join(", ")}` : null;
  }));
  const triggers = triggersRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const tags = (opt("tags") ?? (await ask("Tags (comma-separated)", sched.cron ? "scheduled" : ""))).split(",").map((s) => s.trim()).filter(Boolean);

  const instructionsFile = opt("instructions") ?? (await ask("Instructions file to copy into CLAUDE.md (blank to fill in later)", "", (v) =>
    !v || fs.existsSync(v) ? null : "File not found."));
  const instructions = instructionsFile ? fs.readFileSync(instructionsFile, "utf8") : undefined;

  const permissionMode = (type === "claude-code"
    ? opt("chat") ?? (await ask("Chat permissions (default = read & answer, plan, acceptEdits = can edit files)", "default", oneOf(["default", "plan", "acceptEdits"])))
    : "default") as PermissionMode;
  const reportsRuns = flag("remote") ? false : await confirm("Does this agent run on this computer (so its runs can be reported)?", true);

  // Reporting hooks: one global install covers every project; skip if already there.
  const globalSettings = path.join(os.homedir(), ".claude", "settings.json");
  const globalInstalled = hasAgentOpsHooks(fs.existsSync(globalSettings) ? fs.readFileSync(globalSettings, "utf8") : null);
  let hooks = opt("hooks") as "global" | "project" | "none" | undefined;
  if (!hooks) {
    if (globalInstalled) hooks = "none";
    else if (type !== "claude-code") hooks = "none";
    else hooks = (await confirm(`Install reporting hooks for all your Claude Code projects in ${globalSettings}? (recommended; a backup is kept)`, true)) ? "global" : "project";
  }

  const input: RegisterInput = {
    id, name, description, type, projectDir, schedule: sched.cron, scheduleLabel: sched.label, timezone,
    triggers, tags, permissionMode, reportsRuns, instructions, url: process.env.AGENT_OPS_URL ?? DEFAULT_URL,
  };
  const errors = validateInput(input, dir);
  if (errors.length) throw new Error(errors.join("\n"));

  console.log(`\n${c.bold("Summary")}`);
  console.log(`  ${name} (${id}) · ${type}`);
  console.log(`  Folder:   ${projectDir}`);
  console.log(`  Schedule: ${sched.label}${timezone ? ` (${timezone})` : ""}`);
  if (triggers.length) console.log(`  Hands work to: ${triggers.join(", ")}`);
  console.log(`  Hooks:    ${globalInstalled && hooks === "none" ? "already installed for all projects" : hooks}`);
  if (!(await confirm("\nCreate it?", true))) return console.log("Nothing changed.");

  const actions = registerAgent(input, { agentsDir: dir, dashboardRoot: ROOT, hooks, force });
  console.log("");
  for (const a of actions) {
    const mark = a.action === "kept" ? c.dim("·") : c.green("✓");
    console.log(`${mark} ${a.action.padEnd(9)} ${a.path}${a.note ? c.dim(`  (${a.note})`) : ""}`);
  }

  console.log(`\n${c.bold("Next")}`);
  console.log(`  1. Edit the instructions: ${c.cyan(path.join(projectDir, "CLAUDE.md"))}`);
  console.log(`  2. With the dashboard running, open ${c.cyan(`${DEFAULT_URL}/agents/${id}`)}. It's already registered.`);
  if (type === "claude-code") {
    console.log(`  3. Work in that folder with Claude Code (or set it as a scheduled task's working folder);`);
    console.log(`     every session there is reported as "${id}". Start a NEW session after installing hooks.`);
  } else {
    console.log(`  3. Have the agent POST its events with "agent_id": "${id}" (see docs/EVENT_SCHEMA.md).`);
  }
  if (!reportsRuns && sched.cron) console.log(c.dim(`  Missed-run alerts are commented out in agents/${id}.yaml until it reports runs.`));
}

main()
  .catch((e) => {
    console.error(`\n${c.red("Not registered:")} ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => rl?.close());
