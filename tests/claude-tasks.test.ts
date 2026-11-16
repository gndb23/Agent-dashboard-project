import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverTasks, parseAppFile, parseSkillFile, resetDiscovery, scheduleFromEntry } from "@/lib/claude-tasks/discover";
import { mergeTasks, nameMatch } from "@/lib/claude-tasks/merge";
import { attributeSession } from "@/lib/claude-tasks/attribute";
import { importHistory, reattributeRuns } from "@/lib/claude-tasks/history";
import { loadRegistry } from "@/lib/registry/registry";
import { createDb } from "@/lib/db/client";
import { ingestEvents } from "@/lib/events/ingest";
import { getRun } from "@/lib/queries";
import { isDue, previousFire } from "@/lib/runner/scheduler";
import { chatAvailability } from "@/lib/chat/runner";

const ENV_KEYS = ["CLAUDE_CONFIG_DIR", "AGENT_OPS_CLAUDE_APP_DIR", "AGENT_OPS_DATA_DIR", "AGENT_OPS_TASK_DIRS", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME"];
let saved: Record<string, string | undefined> = {};
let t: string;

function skill(root: string, name: string, fm: string, body: string) {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, "SKILL.md"), `---\n${fm}\n---\n\n${body}\n`);
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  t = fs.mkdtempSync(path.join(os.tmpdir(), "ctasks-"));
  process.env.HOME = process.env.USERPROFILE = path.join(t, "home");
  process.env.XDG_CONFIG_HOME = path.join(t, "home", ".config");
  process.env.CLAUDE_CONFIG_DIR = path.join(t, "home", ".claude");
  process.env.AGENT_OPS_CLAUDE_APP_DIR = path.join(t, "app");
  process.env.AGENT_OPS_DATA_DIR = path.join(t, "data");
  delete process.env.AGENT_OPS_TASK_DIRS;
  resetDiscovery();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  resetDiscovery();
});

function fixture() {
  const root = path.join(t, "home", ".claude", "scheduled-tasks");
  const work = path.join(t, "work");
  fs.mkdirSync(path.join(work, "portfolio"), { recursive: true });
  fs.mkdirSync(path.join(work, "shop"), { recursive: true });
  skill(root, "portfolio-data-gathering", "name: portfolio-data-gathering\ndescription: Daily data gathering (Sonnet)", "You are the owner's portfolio DATA GATHERER. You run once a day at about 05:00 Singapore time.");
  skill(root, "portfolio-research-agent", "name: Portfolio research agent (twice daily)\ndescription: Reviewer and analyst", "You are the owner's portfolio research REVIEWER and analyst (Opus). Read the gathered data.");
  skill(root, "daily-inventory-sync", "name: daily-inventory-sync\ndescription: Shopify vs stock list", "You run the daily Everflow Supplies inventory sync at 8:00 Singapore time. Compare Shopify with the stock list.");
  fs.mkdirSync(path.join(t, "app", "claude-code-sessions", "acct", "org"), { recursive: true });
  fs.writeFileSync(
    path.join(t, "app", "claude-code-sessions", "acct", "org", "scheduled-tasks.json"),
    JSON.stringify({
      scheduledTasks: [
        { id: "a1", name: "portfolio-data-gathering", cronExpression: "0 5 * * *", cwd: path.join(work, "portfolio"), enabled: true, model: "sonnet", permissionMode: "acceptEdits" },
        { id: "a2", taskName: "portfolio-research-agent", schedule: { type: "daily", time: "05:30" }, folder: path.join(work, "portfolio"), status: "active" },
        { id: "a3", skillPath: path.join(root, "daily-inventory-sync", "SKILL.md"), name: "Daily inventory sync", cron: "0 8 * * *", workingDirectory: path.join(work, "shop"), paused: true },
      ],
    }),
  );
  return { root, work };
}

describe("discovery", () => {
  it("parses SKILL.md front matter and body", () => {
    expect(parseSkillFile("---\nname: x\ndescription: d\n---\nDo it.")).toEqual({ name: "x", description: "d", body: "Do it." });
    expect(parseSkillFile("No front matter")).toEqual({ body: "No front matter" });
  });

  it("reads many schedule shapes", () => {
    expect(scheduleFromEntry({ cronExpression: "0 5 * * *" })).toBe("0 5 * * *");
    expect(scheduleFromEntry({ schedule: { type: "weekdays", time: "08:15" } })).toBe("15 8 * * 1-5");
    expect(scheduleFromEntry({ schedule: "hourly" })).toBe("0 * * * *");
    expect(scheduleFromEntry({ frequency: "weekly", dayOfWeek: "Mon", hour: 9, minute: 0 })).toBe("0 9 * * 1");
    expect(scheduleFromEntry({ schedule: { type: "manual" } })).toBeUndefined();
    expect(parseAppFile({ tasks: { "my-task": { cron: "0 1 * * *", enabled: false } } })[0]).toMatchObject({ name: "my-task", cron: "0 1 * * *", enabled: false });
  });

  it("finds the tasks with their schedule, folder and state from the app file", () => {
    const { work } = fixture();
    const { tasks, report } = discoverTasks({ force: true });
    expect(tasks.map((x) => x.taskName).sort()).toEqual(["daily-inventory-sync", "portfolio-data-gathering", "portfolio-research-agent"]);
    const by = Object.fromEntries(tasks.map((x) => [x.taskName, x]));
    expect(by["portfolio-data-gathering"]).toMatchObject({ cron: "0 5 * * *", cwd: path.join(work, "portfolio"), enabled: true, model: "sonnet", permissionMode: "acceptEdits" });
    expect(by["portfolio-research-agent"]).toMatchObject({ title: "Portfolio research agent (twice daily)", cron: "30 5 * * *", enabled: true });
    expect(by["daily-inventory-sync"]).toMatchObject({ cron: "0 8 * * *", cwd: path.join(work, "shop"), enabled: false });
    expect(report.appFiles).toHaveLength(1);
    expect(report.taskRoots[0]).toMatchObject({ exists: true, tasks: 3 });
  });

  it("still lists tasks when the app file is missing, and picks up new tasks", () => {
    const root = path.join(t, "home", ".claude", "scheduled-tasks");
    skill(root, "solo", "name: solo", "Do the solo thing.");
    expect(discoverTasks({ force: true }).tasks[0]).toMatchObject({ taskName: "solo", cron: undefined, cwd: undefined });
    skill(root, "another", "name: another", "Another.");
    expect(discoverTasks({ force: true }).tasks.map((x) => x.taskName)).toEqual(["another", "solo"]);
  });
});

describe("merge into the registry", () => {
  it("matches names that differ in wording", () => {
    expect(nameMatch("Portfolio Data Gatherer", "Portfolio data gathering (Sonnet, daily)")).toBeGreaterThanOrEqual(0.8);
    expect(nameMatch("Daily Inventory Sync", "Daily inventory sync (Shopify vs stock list)")).toBeGreaterThanOrEqual(0.8);
    expect(nameMatch("PR Reviewer", "Portfolio research agent")).toBe(0);
  });

  it("breaks ties: an id that starts the task name wins, then the closer full name", () => {
    const dir = path.join(t, "agents2");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "portfolio-research.yaml"), "id: portfolio-research\nname: Portfolio Research\n");
    fs.writeFileSync(path.join(dir, "portfolio-research-agent.yaml"), "id: portfolio-research-agent\nname: Portfolio Research Agent\n");
    const task = { taskName: "portfolio-research-agent-twice-daily", title: "Portfolio Research Agent Twice Daily", description: "", instructions: "x", taskDir: "/t", skillFile: "/t/SKILL.md", updatedAt: 0 };
    const reg = mergeTasks(loadRegistry(dir), [task], "UTC");
    expect(reg.byId.get("portfolio-research-agent")!.origin?.taskName).toBe("portfolio-research-agent-twice-daily");
    expect(reg.byId.get("portfolio-research")!.origin).toBeUndefined();
    const reg2 = mergeTasks(loadRegistry(dir), [{ ...task, taskName: "research-portfolio-agent-x" }], "UTC");
    expect(reg2.byId.get("portfolio-research-agent")!.origin?.taskName).toBe("research-portfolio-agent-x"); // closer full name
  });

  it("links existing manifests and creates agents for the rest, with real schedules and folders", () => {
    const { work } = fixture();
    const dir = path.join(t, "agents");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "portfolio-data-gatherer.yaml"), "id: portfolio-data-gatherer\nname: Portfolio Data Gatherer\ntriggers: [portfolio-research-agent]\nschedule: \"0 4 * * *\"\n");
    const reg = mergeTasks(loadRegistry(dir), discoverTasks({ force: true }).tasks, "Asia/Singapore");
    expect(reg.errors).toEqual([]); // the trigger target exists once tasks are merged
    const g = reg.byId.get("portfolio-data-gatherer")!;
    expect(g).toMatchObject({ schedule: "0 5 * * *", timezone: "Asia/Singapore", project_dir: path.join(work, "portfolio"), triggers: ["portfolio-research-agent"] });
    expect(g.origin).toMatchObject({ taskName: "portfolio-data-gathering", virtual: false, cronSource: "app" });
    const r = reg.byId.get("portfolio-research-agent")!;
    expect(r.origin?.virtual).toBe(true);
    expect(r.alert_rules.map((x) => x.type)).toEqual(["consecutive_failures", "no_run_within"]);
    const inv = reg.byId.get("daily-inventory-sync")!;
    expect(inv.alert_rules.map((x) => x.type)).toEqual(["consecutive_failures"]); // paused: no missed-run alert
    const chat = chatAvailability(inv);
    expect(chat).toMatchObject({ enabled: true, projectDir: path.join(work, "shop") });
    if (chat.enabled) {
      expect(chat.addDirs[0]).toMatch(/daily-inventory-sync$/);
      expect(chat.instructions).toMatch(/Everflow Supplies/);
    }
  });
});

describe("run attribution and history import", () => {
  function transcript(session: string, cwd: string, prompt: string) {
    return [
      { type: "user", uuid: "u1", sessionId: session, cwd, timestamp: "2026-11-16T05:00:00Z", message: { role: "user", content: prompt } },
      { type: "assistant", uuid: "a1", sessionId: session, timestamp: "2026-11-16T05:01:00Z", message: { id: "m1", model: "claude-sonnet-5-5", usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "x" } }] } },
    ].map((l) => JSON.stringify(l)).join("\n");
  }

  it("attributes sessions by task name, instructions or folder", () => {
    const { work } = fixture();
    const reg = mergeTasks(loadRegistry(path.join(t, "none")), discoverTasks({ force: true }).tasks, "UTC");
    expect(attributeSession(reg, { prompt: "<command-name>/daily-inventory-sync</command-name>" })).toBe("daily-inventory-sync");
    expect(attributeSession(reg, { prompt: "You are the owner's portfolio DATA GATHERER. You run once a day at about 05:00 Singapore time. Extra." })).toBe("portfolio-data-gathering");
    expect(attributeSession(reg, { cwd: path.join(work, "portfolio"), prompt: "hello" })).toBeNull(); // task agents need a prompt match
    expect(attributeSession(reg, { prompt: "fix the bug" })).toBeNull();
  });

  it("imports scheduled-task runs incrementally and skips dashboard sessions", () => {
    const { work } = fixture();
    const reg = mergeTasks(loadRegistry(path.join(t, "none")), discoverTasks({ force: true }).tasks, "UTC");
    const projects = path.join(t, "home", ".claude", "projects", "-work-shop");
    fs.mkdirSync(projects, { recursive: true });
    fs.writeFileSync(path.join(projects, "s1.jsonl"), transcript("s1", path.join(work, "shop"), "You run the daily Everflow Supplies inventory sync at 8:00 Singapore time. Compare Shopify with the stock list."));
    fs.writeFileSync(path.join(projects, "chat1.jsonl"), transcript("chat1", path.join(work, "shop"), "what's in the stock list?"));
    const db = createDb(":memory:");
    db.$client.prepare(`INSERT INTO chat_messages (agent_id, conversation_id, role, text, session_id, status, created_at) VALUES ('x','c','assistant','',?, 'done', 1)`).run("chat1");
    const now = Date.parse("2026-11-16T06:00:00Z");
    const r1 = importHistory(db, reg, { now });
    expect(r1).toMatchObject({ imported: 1, skipped: 1 });
    expect(getRun(db, "s1")!.run).toMatchObject({ agentId: "daily-inventory-sync", toolCount: 1, status: "success" });
    expect(importHistory(db, reg, { now })).toMatchObject({ imported: 0 }); // unchanged files are not re-read
  });

  it("moves a live hook session to the task once its first prompt arrives", () => {
    fixture();
    const reg = mergeTasks(loadRegistry(path.join(t, "none")), discoverTasks({ force: true }).tasks, "UTC");
    const db = createDb(":memory:");
    const ev = (o: Record<string, unknown>) => ({ schema_version: 1, agent_id: "shop", run_id: "live1", source: "claude-code-hook", ...o });
    ingestEvents(db, [ev({ event_type: "run_started", payload: { cwd: "/somewhere/shop" } }), ev({ event_type: "message", payload: { text: "/daily-inventory-sync" } })]);
    expect(reattributeRuns(db, reg, ["live1"])).toBe(1);
    expect(getRun(db, "live1")!.run.agentId).toBe("daily-inventory-sync");
    expect(getRun(db, "live1")!.events.every((e) => e.id > 0)).toBe(true);
  });
});

describe("built-in scheduler timing", () => {
  it("fires once per scheduled time, only shortly after it", () => {
    const now = new Date("2026-11-16T05:02:00Z");
    const prev = previousFire("0 5 * * *", "UTC", now)!;
    expect(prev.toISOString()).toBe("2026-11-16T05:00:00.000Z");
    expect(isDue(prev, undefined, now)).toBe(true);
    expect(isDue(prev, prev.getTime(), now)).toBe(false);
    expect(isDue(prev, undefined, new Date("2026-11-16T06:00:00Z"))).toBe(false); // too late: skip, don't catch up
    expect(previousFire("0 5 * * *", "UTC", new Date("2026-11-16T05:00:00Z"))!.toISOString()).toBe("2026-11-16T05:00:00.000Z");
  });
});
