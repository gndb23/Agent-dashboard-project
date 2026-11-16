import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { parseManifest, type AgentManifest } from "./registry/manifest";

/** Fields the Settings tab can change. `null` removes a field. */
export type ManifestPatch = {
  name?: string;
  description?: string;
  owner?: string;
  schedule?: string | null;
  timezone?: string | null;
  project_dir?: string | null;
  extra_dirs?: string[];
  triggers?: string[];
  tags?: string[];
  scheduled_task?: string | null;
  expected_runtime_minutes?: number | null;
  chat?: { permission_mode: "default" | "plan" | "acceptEdits" } | null;
  run?: { prompt?: string; on_schedule?: boolean; permission_mode?: string; max_minutes?: number; model?: string } | null;
  alert_rules?: AgentManifest["alert_rules"];
};

const clean = (v: unknown): unknown => {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const o = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== ""));
    return Object.keys(o).length ? o : null;
  }
  return v;
};

/**
 * Applies a patch to manifest YAML text while keeping comments and layout
 * (yaml Document API). Returns the new text; throws with a readable message if the result is invalid.
 */
export function patchManifestText(text: string, id: string, patch: ManifestPatch): string {
  const doc = YAML.parseDocument(text);
  if (doc.errors.length) throw new Error(`The manifest has a YAML error: ${doc.errors[0].message}`);
  for (const [k, raw] of Object.entries(patch)) {
    if (raw === undefined) continue;
    const v = clean(raw);
    const empty = v === null || (Array.isArray(v) && v.length === 0 && ["extra_dirs", "triggers"].includes(k));
    if (empty) doc.delete(k);
    else doc.set(k, v);
  }
  const out = doc.toString();
  const r = parseManifest(out, `${id}.yaml`);
  if (!r.ok) throw new Error(r.error);
  return out;
}

export function writeWithBackup(file: string, text: string) {
  if (fs.existsSync(file)) fs.writeFileSync(`${file}.bak`, fs.readFileSync(file));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Starting point for agents that exist only because a Claude task does (no file yet). */
export function manifestFromAgent(m: AgentManifest): string {
  const base: Record<string, unknown> = {
    id: m.id,
    name: m.name,
    description: m.description,
    type: m.type,
    ...(m.scheduled_task ? { scheduled_task: m.scheduled_task } : {}),
    ...(m.project_dir ? { project_dir: m.project_dir.replace(/\\/g, "/") } : {}),
    tags: m.tags,
    alert_rules: m.alert_rules,
  };
  return `# Settings for the Claude scheduled task "${m.scheduled_task ?? m.id}" (schedule and instructions come from the Claude app)\n${YAML.stringify(base)}`;
}

/** Moves a manifest to agents/_archived/ (reversible: move it back). */
export function archiveManifest(agentsDir: string, id: string): string {
  const src = path.join(agentsDir, `${id}.yaml`);
  if (!fs.existsSync(src)) throw new Error(`agents/${id}.yaml doesn't exist`);
  const dir = path.join(agentsDir, "_archived");
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}.yaml`);
  fs.renameSync(src, dst);
  return dst;
}
