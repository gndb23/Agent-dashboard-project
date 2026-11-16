import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hookCommand } from "../hook-config";
import { hasAgentOpsHooks, mergeHooksIntoSettings } from "../register";

export function globalSettingsFile(home = process.env.USERPROFILE || process.env.HOME || os.homedir()) {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "settings.json");
}

export function hooksInstalled(): boolean {
  const f = globalSettingsFile();
  return fs.existsSync(f) && hasAgentOpsHooks(fs.readFileSync(f, "utf8"));
}

/** Merges the reporting hooks into the user's Claude settings (all projects), keeping a .bak copy. */
export function installGlobalHooks(root = process.cwd()): { file: string; changed: boolean } {
  const file = globalSettingsFile();
  const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const merged = mergeHooksIntoSettings(old, hookCommand({ root }));
  if (merged.changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (old !== null) fs.writeFileSync(`${file}.bak`, old);
    fs.writeFileSync(file, merged.text);
  }
  return { file, changed: merged.changed };
}
