/**
 * Finds the Claude Desktop app's local scheduled tasks on this computer.
 *
 * - Instructions: ~/.claude/scheduled-tasks/<task-name>/SKILL.md (or under CLAUDE_CONFIG_DIR),
 *   YAML front matter with `name` and `description`, the prompt as the body (official docs).
 * - Schedule, working folder, enabled state, model: kept by the app in a `scheduled-tasks.json`
 *   inside its data folder. That format isn't documented, so it is read defensively and
 *   anything missing is simply left blank.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { CronExpressionParser } from "cron-parser";
import { readSettings } from "../settings";

export type DiscoveredTask = {
  taskName: string; // folder name, kebab-case
  title: string;
  description: string;
  instructions: string;
  taskDir: string;
  skillFile: string;
  cron?: string;
  cwd?: string;
  enabled?: boolean;
  model?: string;
  permissionMode?: string;
  settingsFile?: string;
  updatedAt: number;
};

export type DiscoveryReport = {
  taskRoots: { dir: string; exists: boolean; tasks: number }[];
  appDirs: { dir: string; exists: boolean }[];
  appFiles: string[];
  errors: string[];
  scannedAt: number;
};

const home = () => process.env.USERPROFILE || process.env.HOME || os.homedir();

export function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(home(), ".claude");
}

export function taskRoots(): string[] {
  const s = readSettings();
  const env = (process.env.AGENT_OPS_TASK_DIRS ?? "").split(path.delimiter).filter(Boolean);
  return [...new Set([path.join(claudeConfigDir(), "scheduled-tasks"), ...s.taskDirs, ...env].map((d) => path.resolve(d)))];
}

export function claudeAppDirs(platform = process.platform): string[] {
  const s = readSettings();
  const h = home();
  const list: string[] = [];
  if (s.claudeAppDir) list.push(s.claudeAppDir);
  if (process.env.AGENT_OPS_CLAUDE_APP_DIR) list.push(process.env.AGENT_OPS_CLAUDE_APP_DIR);
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(h, "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA ?? path.join(h, "AppData", "Local");
    list.push(path.join(appData, "Claude"), path.join(local, "Claude"), path.join(local, "AnthropicClaude"));
  } else if (platform === "darwin") {
    list.push(path.join(h, "Library", "Application Support", "Claude"));
  } else {
    list.push(path.join(process.env.XDG_CONFIG_HOME ?? path.join(h, ".config"), "Claude"));
  }
  return [...new Set(list)];
}

// ------------------------------------------------------------------ SKILL.md

export function parseSkillFile(text: string): { name?: string; description?: string; body: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { body: text.trim() };
  let fm: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(m[1]);
    if (parsed && typeof parsed === "object") fm = parsed as Record<string, unknown>;
  } catch {
    /* ignore bad front matter */
  }
  return {
    name: typeof fm.name === "string" ? fm.name : undefined,
    description: typeof fm.description === "string" ? fm.description : undefined,
    body: m[2].trim(),
  };
}

function titleCase(slug: string) {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function slugifyTaskName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ------------------------------------------------------------------ app settings file

const SKIP_DIRS = new Set(["node_modules", "Cache", "Code Cache", "GPUCache", "IndexedDB", "blob_storage", "Service Worker", "Crashpad", "logs", "Local Storage", "Session Storage", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "Shared Dictionary", "WebStorage", "VideoDecodeStats", "vm_bundles", "claude-code-vm"]);

/** Finds files named scheduled-tasks.json inside a folder (bounded depth). */
export function findAppFiles(root: string, maxDepth = 6): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || out.length > 50) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase() === "scheduled-tasks.json") out.push(path.join(dir, e.name));
      else if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export type AppTaskEntry = {
  name?: string;
  cron?: string;
  cwd?: string;
  enabled?: boolean;
  model?: string;
  permissionMode?: string;
  skillPath?: string;
};

const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function isCron(s: string) {
  if (s.trim().split(/\s+/).length !== 5) return false;
  try {
    CronExpressionParser.parse(s);
    return true;
  } catch {
    return false;
  }
}

function hhmmOf(o: Record<string, unknown>): [number, number] | null {
  const t = str(pick(o, ["time", "timeOfDay", "at"]));
  if (t) {
    const m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (m) return [Number(m[1]), Number(m[2])];
  }
  const h = pick(o, ["hour", "hours"]);
  const mi = pick(o, ["minute", "minutes"]);
  if (typeof h === "number") return [h, typeof mi === "number" ? mi : 0];
  return null;
}

/** Turns the many possible schedule shapes into a 5-field cron (local time), when possible. */
export function scheduleFromEntry(o: Record<string, unknown>): string | undefined {
  const direct = str(pick(o, ["cronExpression", "cron", "cron_expression", "cronSchedule"]));
  if (direct && isCron(direct)) return direct;
  const sched = pick(o, ["schedule", "trigger", "recurrence", "frequency"]);
  if (typeof sched === "string" && isCron(sched)) return sched;
  const so = sched && typeof sched === "object" ? (sched as Record<string, unknown>) : o;
  const inner = str(pick(so, ["cronExpression", "cron", "expression"]));
  if (inner && isCron(inner)) return inner;
  const kind = (str(pick(so, ["type", "kind", "preset", "frequency"])) ?? (typeof sched === "string" ? sched : ""))?.toLowerCase();
  const t = hhmmOf(so) ?? hhmmOf(o);
  if (kind === "hourly") return `${t?.[1] ?? 0} * * * *`;
  if (!t) return undefined;
  const [h, m] = t;
  if (kind === "daily") return `${m} ${h} * * *`;
  if (kind === "weekdays") return `${m} ${h} * * 1-5`;
  if (kind === "weekly") {
    const d = pick(so, ["dayOfWeek", "day", "weekday"]);
    const day = typeof d === "number" ? d : ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(String(d ?? "").slice(0, 3).toLowerCase());
    return `${m} ${h} * * ${day >= 0 ? day : 1}`;
  }
  return undefined;
}

/** Collects every object in the JSON that looks like a task entry. */
export function parseAppFile(json: unknown): AppTaskEntry[] {
  const out: AppTaskEntry[] = [];
  const visit = (v: unknown, keyName?: string, depth = 0) => {
    if (depth > 8 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, undefined, depth + 1));
    const o = v as Record<string, unknown>;
    const name = str(pick(o, ["taskName", "name", "slug", "skillName", "skill", "id", "title"])) ?? keyName;
    const cron = scheduleFromEntry(o);
    const cwd = str(pick(o, ["cwd", "folder", "workingDirectory", "workingDir", "localFolder", "directory", "projectPath", "folderPath", "workspace", "path"]));
    const skillPath = str(pick(o, ["skillPath", "skillFile", "promptPath", "filePath"]));
    const looksLikeTask = Boolean(name) && (cron !== undefined || cwd !== undefined || skillPath !== undefined || "enabled" in o || "paused" in o || "status" in o);
    if (looksLikeTask) {
      const enabledRaw = pick(o, ["enabled", "isEnabled", "active"]);
      const paused = pick(o, ["paused", "isPaused", "disabled"]);
      const status = str(o.status)?.toLowerCase();
      out.push({
        name,
        cron,
        cwd,
        skillPath,
        enabled: typeof enabledRaw === "boolean" ? enabledRaw : typeof paused === "boolean" ? !paused : status ? status === "active" || status === "enabled" : undefined,
        model: str(pick(o, ["model", "modelId"])),
        permissionMode: str(pick(o, ["permissionMode", "permission_mode", "mode"])),
      });
    }
    for (const [k, child] of Object.entries(o)) if (child && typeof child === "object") visit(child, Array.isArray(o) ? undefined : k, depth + 1);
  };
  visit(json);
  return out;
}

// ------------------------------------------------------------------ discovery (cached)

type Cache = { at: number; appFilesAt: number; appFiles: string[]; tasks: DiscoveredTask[]; report: DiscoveryReport; sig: string };
const g = globalThis as unknown as { __agentOpsTasks?: Cache };

function statSig(files: string[]) {
  return files
    .map((f) => {
      try {
        const s = fs.statSync(f);
        return `${f}:${s.mtimeMs}:${s.size}`;
      } catch {
        return `${f}:-`;
      }
    })
    .join("|");
}

function skillFilesIn(root: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    for (const n of ["SKILL.md", "skill.md", "Skill.md"]) {
      const f = path.join(root, e.name, n);
      if (fs.existsSync(f)) {
        out.push(f);
        break;
      }
    }
  }
  return out;
}

/**
 * Returns the scheduled tasks on this computer. Cheap to call often: SKILL.md files are
 * re-checked every few seconds, the app data folder is searched at most once a minute.
 */
export function discoverTasks(opts: { force?: boolean } = {}): { tasks: DiscoveredTask[]; report: DiscoveryReport } {
  const now = Date.now();
  const c = g.__agentOpsTasks;
  if (!opts.force && c && now - c.at < 3000) return { tasks: c.tasks, report: c.report };

  const roots = taskRoots();
  const skillFiles = roots.flatMap(skillFilesIn);
  const appDirs = claudeAppDirs();
  const appFiles = !opts.force && c && now - c.appFilesAt < 60_000 ? c.appFiles : appDirs.flatMap((d) => findAppFiles(d));
  const sig = statSig([...skillFiles, ...appFiles]) + "#" + roots.join("|");
  if (!opts.force && c && c.sig === sig) {
    c.at = now;
    if (appFiles !== c.appFiles) {
      c.appFiles = appFiles;
      c.appFilesAt = now;
    }
    return { tasks: c.tasks, report: c.report };
  }

  const errors: string[] = [];
  // App entries, newest file wins per task name.
  const entries = new Map<string, AppTaskEntry & { file: string; mtime: number }>();
  for (const f of appFiles) {
    try {
      const mtime = fs.statSync(f).mtimeMs;
      for (const e of parseAppFile(JSON.parse(fs.readFileSync(f, "utf8")))) {
        const keys = [e.name, e.skillPath ? path.basename(path.dirname(e.skillPath)) : undefined].filter(Boolean).map((k) => slugifyTaskName(k!));
        for (const k of keys) {
          const prev = entries.get(k);
          if (!prev || prev.mtime <= mtime) entries.set(k, { ...prev, ...Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)), file: f, mtime });
        }
      }
    } catch (e) {
      errors.push(`${f}: ${(e as Error).message}`);
    }
  }

  const tasks: DiscoveredTask[] = [];
  const seen = new Set<string>();
  for (const skillFile of skillFiles) {
    const taskDir = path.dirname(skillFile);
    const taskName = path.basename(taskDir);
    if (seen.has(taskName)) continue;
    seen.add(taskName);
    try {
      const parsed = parseSkillFile(fs.readFileSync(skillFile, "utf8"));
      const app = entries.get(slugifyTaskName(taskName)) ?? (parsed.name ? entries.get(slugifyTaskName(parsed.name)) : undefined);
      tasks.push({
        taskName,
        title: parsed.name && parsed.name !== taskName ? parsed.name : titleCase(taskName),
        description: parsed.description ?? "",
        instructions: parsed.body,
        taskDir,
        skillFile,
        cron: app?.cron,
        cwd: app?.cwd && fs.existsSync(app.cwd) ? path.resolve(app.cwd) : app?.cwd,
        enabled: app?.enabled,
        model: app?.model,
        permissionMode: app?.permissionMode,
        settingsFile: app?.file,
        updatedAt: fs.statSync(skillFile).mtimeMs,
      });
    } catch (e) {
      errors.push(`${skillFile}: ${(e as Error).message}`);
    }
  }
  tasks.sort((a, b) => a.title.localeCompare(b.title));

  const report: DiscoveryReport = {
    taskRoots: roots.map((d) => ({ dir: d, exists: fs.existsSync(d), tasks: tasks.filter((t) => path.dirname(t.taskDir) === d).length })),
    appDirs: appDirs.map((d) => ({ dir: d, exists: fs.existsSync(d) })),
    appFiles,
    errors,
    scannedAt: now,
  };
  g.__agentOpsTasks = { at: now, appFilesAt: c && appFiles === c.appFiles ? c.appFilesAt : now, appFiles, tasks, report, sig };
  return { tasks, report };
}

/** Forget the cache (after settings change). */
export function resetDiscovery() {
  g.__agentOpsTasks = undefined;
}
