import path from "node:path";
import type { Registry } from "../registry/registry";

const norm = (s: string) => s.toLowerCase().replace(/[`*_#>\[\]()]/g, " ").replace(/\s+/g, " ").trim();
const samePath = (a: string, b: string) => {
  const n = (p: string) => path.resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" || /^[a-z]:/i.test(a) ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

/**
 * Decides which registered agent a Claude Code session belongs to.
 * 1. Claude scheduled tasks: the first prompt names the task (skill / folder name) or starts with its instructions.
 * 2. Other agents with a working folder: the session ran in exactly that folder (only when unambiguous).
 * Returns null when nothing matches (the caller then uses its default, e.g. the folder name).
 */
export function attributeSession(reg: Registry, s: { cwd?: string; prompt?: string }): string | null {
  const prompt = s.prompt ? norm(s.prompt) : "";
  if (prompt) {
    for (const a of reg.agents) {
      const o = a.origin;
      if (!o) continue;
      const name = o.taskName.toLowerCase();
      if (
        prompt.includes(`scheduled-tasks/${name}`) ||
        prompt.includes(`scheduled-tasks\\${name}`) ||
        new RegExp(`(^|[\\s/])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s.,:<"])`).test(prompt)
      ) {
        return a.id;
      }
      const head = norm(o.instructions).slice(0, 160);
      if (head.length >= 40 && prompt.includes(head.slice(0, Math.min(head.length, 120)))) return a.id;
    }
  }
  if (s.cwd) {
    const matches = reg.agents.filter((a) => !a.origin && a.project_dir && samePath(a.project_dir, s.cwd!));
    if (matches.length === 1) return matches[0].id;
  }
  return null;
}
