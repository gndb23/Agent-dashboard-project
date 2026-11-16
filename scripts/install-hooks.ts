/** Installs the Claude Code reporting hooks for all projects (used by the Windows installer). */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installGlobalHooks } from "../src/lib/system/hooks";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = installGlobalHooks(root);
console.log(r.changed ? `Hooks installed in ${r.file} (backup: ${r.file}.bak)` : `Hooks already installed in ${r.file}`);
