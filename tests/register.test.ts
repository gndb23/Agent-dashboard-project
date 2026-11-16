import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildClaudeMd, buildManifestYaml, hasAgentOpsHooks, mergeHooksIntoSettings, missedRunHours,
  registerAgent, scheduleToCron, slugify,
} from "@/lib/register";
import { loadRegistry } from "@/lib/registry/registry";
import { parseManifest } from "@/lib/registry/manifest";
import { chatAvailability } from "@/lib/chat/runner";
import { hookCommand } from "@/lib/hook-config";
import { findAgentFile, toEvent, parseArgs } from "../integrations/claude-code/hook.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
const ROOT = path.resolve(__dirname, "..");

describe("scheduleToCron", () => {
  it("understands friendly schedules and cron", () => {
    expect(scheduleToCron("")).toEqual({ cron: null, label: "on demand" });
    expect(scheduleToCron("daily 05:30")).toEqual({ cron: "30 5 * * *", label: "daily at 05:30" });
    expect(scheduleToCron("Daily at 5pm")).toMatchObject({ cron: "0 17 * * *" });
    expect(scheduleToCron("weekdays 8:00")).toMatchObject({ cron: "0 8 * * 1-5" });
    expect(scheduleToCron("every 30m")).toMatchObject({ cron: "*/30 * * * *" });
    expect(scheduleToCron("every 2h")).toMatchObject({ cron: "0 */2 * * *" });
    expect(scheduleToCron("hourly")).toMatchObject({ cron: "0 * * * *" });
    expect(scheduleToCron("0 5 * * *")).toMatchObject({ cron: "0 5 * * *" });
    for (const bad of ["daily 25:00", "every 7m", "sometimes", "99 99 * * *"]) expect(scheduleToCron(bad), bad).toHaveProperty("error");
  });

  it("sizes the missed-run window to the schedule's longest gap", () => {
    expect(missedRunHours("0 5 * * *", "Asia/Singapore")).toBe(27);
    expect(missedRunHours("0 8 * * 1-5", "Asia/Singapore")).toBe(80); // Friday → Monday
    expect(missedRunHours("*/30 * * * *")).toBe(2);
  });

  it("slugifies names", () => {
    expect(slugify("Daily Inventory Sync!")).toBe("daily-inventory-sync");
    expect(slugify("  Café   Ops  ")).toBe("cafe-ops");
  });
});

describe("generated files", () => {
  const base = {
    id: "inventory-sync", name: "Daily: Inventory Sync", description: 'Shopify vs "stock" list', projectDir: "C:\\Users\\alvin\\agents\\inventory-sync",
    schedule: "0 8 * * *", scheduleLabel: "daily at 08:00", timezone: "Asia/Singapore", tags: ["Scheduled", "e-commerce"],
  };

  it("builds a manifest that validates, with Windows paths and quoting handled", () => {
    const yaml = buildManifestYaml({ ...base, permissionMode: "acceptEdits", reportsRuns: true });
    const r = parseManifest(yaml, "inventory-sync.yaml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest).toMatchObject({
      name: "Daily: Inventory Sync", description: 'Shopify vs "stock" list', schedule: "0 8 * * *", timezone: "Asia/Singapore",
      tags: ["scheduled", "e-commerce"], chat: { permission_mode: "acceptEdits" },
    });
    expect(r.manifest.project_dir).toMatch(/inventory-sync$/);
    expect(r.manifest.project_dir).not.toContain("\\");
    expect(r.manifest.alert_rules.map((x) => x.type)).toEqual(["consecutive_failures", "no_run_within"]);
    expect(chatAvailability(r.manifest).enabled).toBe(true);
  });

  it("comments out the missed-run alert for agents that don't report yet", () => {
    const r = parseManifest(buildManifestYaml({ ...base, reportsRuns: false }), "inventory-sync.yaml");
    expect(r.ok && r.manifest.alert_rules.map((x) => x.type)).toEqual(["consecutive_failures"]);
    const onDemand = parseManifest(buildManifestYaml({ ...base, schedule: null }), "inventory-sync.yaml");
    expect(onDemand.ok && onDemand.manifest.schedule).toBeUndefined();
  });

  it("writes CLAUDE.md with instructions or a placeholder", () => {
    expect(buildClaudeMd({ ...base, instructions: "Compare stock." })).toContain("## Instructions\n\nCompare stock.");
    expect(buildClaudeMd(base)).toContain("Write what this agent should do here");
    expect(buildClaudeMd(base)).toContain("`inventory-sync`");
  });
});

describe("mergeHooksIntoSettings", () => {
  const cmd = 'node "C:\\dev\\Agent-dashboard-project\\integrations\\claude-code\\hook.mjs"';

  it("keeps existing settings and other hooks, and is idempotent", () => {
    const existing = JSON.stringify({
      theme: "dark",
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-linter" }] }] },
    });
    const once = mergeHooksIntoSettings(existing, cmd);
    const s = JSON.parse(once.text);
    expect(s.theme).toBe("dark");
    expect(s.hooks.PreToolUse).toHaveLength(2);
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe("my-linter");
    expect(hasAgentOpsHooks(once.text)).toBe(true);
    const twice = mergeHooksIntoSettings(once.text, cmd);
    expect(twice.changed).toBe(false);
    expect(JSON.parse(twice.text).hooks.Stop).toHaveLength(1);
  });

  it("replaces an older Agent Ops hook command instead of duplicating it", () => {
    const old = mergeHooksIntoSettings(null, 'AGENT_ID=x node "/old/place/integrations/claude-code/hook.mjs"').text;
    const s = JSON.parse(mergeHooksIntoSettings(old, cmd).text);
    expect(s.hooks.Stop).toHaveLength(1);
    expect(s.hooks.Stop[0].hooks[0].command).toBe(cmd);
  });

  it("refuses to touch invalid JSON", () => {
    expect(() => mergeHooksIntoSettings("{ nope", cmd)).toThrow(/not valid JSON/);
    expect(hasAgentOpsHooks("{ nope")).toBe(false);
  });
});

describe("registerAgent (end to end on disk)", () => {
  function setup() {
    const t = tmp();
    const agents = path.join(t, "agents");
    fs.mkdirSync(agents);
    fs.writeFileSync(path.join(agents, "portfolio-data-gatherer.yaml"), "id: portfolio-data-gatherer\nname: Gatherer\n");
    const home = path.join(t, "home");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ autoUpdatesChannel: "latest", theme: "dark" }));
    return { t, agents, home };
  }

  it("creates the manifest, folder, CLAUDE.md, agent file and global hooks", () => {
    const { t, agents, home } = setup();
    const projectDir = path.join(t, "work", "Research Folder");
    const actions = registerAgent(
      { id: "portfolio-research-agent", name: "Portfolio Research Agent", projectDir, schedule: "30 5 * * *", timezone: "Asia/Singapore",
        triggers: [], instructions: "Review the gathered data.", reportsRuns: true },
      { agentsDir: agents, dashboardRoot: ROOT, homeDir: home, hooks: "global" },
    );
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["created", "backed up", "updated"]));

    const reg = loadRegistry(agents);
    expect(reg.errors).toEqual([]);
    expect(reg.byId.get("portfolio-research-agent")?.project_dir).toBe(projectDir.replace(/\\/g, "/"));
    expect(fs.readFileSync(path.join(projectDir, "CLAUDE.md"), "utf8")).toContain("Review the gathered data.");

    const settings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
    expect(settings.theme).toBe("dark");
    expect(settings.autoUpdatesChannel).toBe("latest");
    expect(hasAgentOpsHooks(JSON.stringify(settings))).toBe(true);
    expect(fs.existsSync(path.join(home, ".claude", "settings.json.bak"))).toBe(true);

    // The hook labels sessions anywhere inside the folder as this agent, whatever the folder is called.
    const sub = path.join(projectDir, "reports", "2026");
    fs.mkdirSync(sub, { recursive: true });
    expect(findAgentFile(sub)?.agent_id).toBe("portfolio-research-agent");
    expect(toEvent({ hook_event_name: "SessionStart", session_id: "s1", cwd: sub }, {})!.agent_id).toBe("portfolio-research-agent");
    expect(toEvent({ hook_event_name: "SessionStart", session_id: "s1", cwd: sub }, { AGENT_ID: "override" })!.agent_id).toBe("override");
  });

  it("never overwrites CLAUDE.md, refuses an existing manifest without force, and validates links", () => {
    const { t, agents, home } = setup();
    const projectDir = path.join(t, "proj");
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(projectDir, "CLAUDE.md"), "my own notes");
    const input = { id: "inventory-sync", name: "Inventory Sync", projectDir, triggers: ["portfolio-data-gatherer"] };
    registerAgent(input, { agentsDir: agents, dashboardRoot: ROOT, homeDir: home, hooks: "project" });
    expect(fs.readFileSync(path.join(projectDir, "CLAUDE.md"), "utf8")).toBe("my own notes");
    expect(hasAgentOpsHooks(fs.readFileSync(path.join(projectDir, ".claude", "settings.json"), "utf8"))).toBe(true);
    expect(hasAgentOpsHooks(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"))).toBe(false);

    expect(() => registerAgent(input, { agentsDir: agents, dashboardRoot: ROOT, hooks: "none" })).toThrow(/already exists/);
    registerAgent({ ...input, name: "Renamed" }, { agentsDir: agents, dashboardRoot: ROOT, hooks: "none", force: true });
    expect(loadRegistry(agents).byId.get("inventory-sync")?.name).toBe("Renamed");
    expect(fs.existsSync(path.join(agents, "inventory-sync.yaml.bak"))).toBe(true);

    expect(() => registerAgent({ ...input, id: "x", triggers: ["ghost"] }, { agentsDir: agents, dashboardRoot: ROOT, hooks: "none" })).toThrow(/isn't a registered agent/);
    expect(() => registerAgent({ ...input, id: "y", projectDir: "relative/dir" }, { agentsDir: agents, dashboardRoot: ROOT, hooks: "none" })).toThrow(/full path/);
    expect(() => registerAgent({ ...input, id: "z", timezone: "Mars/Base" }, { agentsDir: agents, dashboardRoot: ROOT, hooks: "none" })).toThrow(/time zone/);
  });
});

describe("hook command line", () => {
  it("passes options as arguments so it works on Windows shells", () => {
    expect(hookCommand({ root: "/opt/ops", agentId: "a1", url: "http://localhost:5000" })).toBe(
      `node "${path.join("/opt/ops", "integrations", "claude-code", "hook.mjs")}" --agent-id a1 --url http://localhost:5000`,
    );
    expect(parseArgs(["--agent-id", "a1", "--url", "http://x"])).toEqual({ agentId: "a1", url: "http://x" });
  });

  it("the hook script actually runs when invoked directly", () => {
    // Guards the "is this the main module" check (it used to fail on Windows paths).
    const out = execFileSync(process.execPath, [path.join(ROOT, "integrations/claude-code/hook.mjs"), "--url", "http://127.0.0.1:9"], {
      input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "x", cwd: os.tmpdir() }),
      env: { ...process.env, AGENT_OPS_DEBUG: "1" },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(out).toBe("");
  });
});

describe("npm run register (non-interactive)", () => {
  it("registers an agent from flags", () => {
    const t = tmp();
    const agents = path.join(t, "agents");
    const home = path.join(t, "home");
    fs.mkdirSync(home);
    const dir = path.join(t, "agents-home", "inventory-sync");
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), path.join(ROOT, "scripts/register-agent.ts"),
        "--name", "Daily Inventory Sync", "--dir", dir, "--schedule", "daily 08:00", "--timezone", "Asia/Singapore",
        "--triggers", "", "--tags", "scheduled,shopify", "--instructions", "", "--chat", "default", "--hooks", "global", "--yes"],
      { env: { ...process.env, HOME: home, USERPROFILE: home, AGENT_OPS_AGENTS_DIR: agents, NO_COLOR: "1" }, encoding: "utf8" },
    );
    expect(out).toContain("inventory-sync");
    const reg = loadRegistry(agents);
    expect(reg.errors).toEqual([]);
    expect(reg.byId.get("daily-inventory-sync")).toMatchObject({ schedule: "0 8 * * *", timezone: "Asia/Singapore", tags: ["scheduled", "shopify"] });
    expect(fs.existsSync(path.join(dir, "CLAUDE.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".claude", "agent-ops.json"))).toBe(true);
    expect(hasAgentOpsHooks(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"))).toBe(true);
  }, 30_000);
});
