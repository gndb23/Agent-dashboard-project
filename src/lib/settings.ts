import fs from "node:fs";
import path from "node:path";

/** Dashboard settings stored in data/settings.json (edited from the Settings page). */
export type AppSettings = {
  /** Extra folders that contain Claude scheduled tasks (each task = a subfolder with SKILL.md). */
  taskDirs: string[];
  /** Override for the Claude desktop app's data folder (where scheduled-tasks.json lives). */
  claudeAppDir?: string;
  /** Import Claude Code session history in the background. */
  autoImportHistory: boolean;
  /** Show browser notifications when alerts open. */
  notifications: boolean;
};

const DEFAULTS: AppSettings = { taskDirs: [], autoImportHistory: true, notifications: false };

export function dataDir() {
  return process.env.AGENT_OPS_DATA_DIR ?? path.join(process.cwd(), "data");
}

function file() {
  return path.join(dataDir(), "settings.json");
}

export function readSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    return {
      ...DEFAULTS,
      ...raw,
      taskDirs: Array.isArray(raw.taskDirs) ? raw.taskDirs.filter((d: unknown) => typeof d === "string") : [],
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2) + "\n");
  return next;
}
