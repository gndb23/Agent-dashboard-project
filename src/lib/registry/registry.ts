import fs from "node:fs";
import path from "node:path";
import { parseManifest, defaultManifestYaml, type AgentManifest } from "./manifest";

export type ManifestError = { file: string; error: string };
export type Registry = {
  agents: AgentManifest[];
  byId: Map<string, AgentManifest>;
  errors: ManifestError[];
  dir: string;
};

export function agentsDir(): string {
  return process.env.AGENT_OPS_AGENTS_DIR ?? path.join(process.cwd(), "agents");
}

/** Pure loader: reads every *.yaml / *.yml in dir (files starting with "_" are ignored). */
export function loadRegistry(dir: string): Registry {
  const agents: AgentManifest[] = [];
  const errors: ManifestError[] = [];
  const byId = new Map<string, AgentManifest>();
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f) && !f.startsWith("_")).sort();
  } catch {
    return { agents, byId, errors, dir };
  }
  for (const file of files) {
    let src: string;
    try {
      src = fs.readFileSync(path.join(dir, file), "utf8");
    } catch (e) {
      errors.push({ file, error: (e as Error).message });
      continue;
    }
    const res = parseManifest(src, file);
    if (!res.ok) {
      errors.push({ file, error: res.error });
      continue;
    }
    if (byId.has(res.manifest.id)) {
      errors.push({ file, error: `Duplicate agent id "${res.manifest.id}"` });
      continue;
    }
    byId.set(res.manifest.id, res.manifest);
    agents.push(res.manifest);
  }
  for (const a of agents) {
    const bad = a.triggers.filter((t) => t === a.id || !byId.has(t));
    if (bad.length) {
      errors.push({
        file: `${a.id}.yaml`,
        error: `triggers references ${bad.map((b) => (b === a.id ? `itself ("${b}")` : `unknown agent "${b}"`)).join(", ")} (the agent still loads; the link is ignored)`,
      });
    }
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { agents, byId, errors, dir };
}

function signature(dir: string): string {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.ya?ml$/i.test(f))
      .map((f) => {
        const s = fs.statSync(path.join(dir, f));
        return `${f}:${s.mtimeMs}:${s.size}`;
      })
      .sort()
      .join("|");
  } catch {
    return "missing";
  }
}

const g = globalThis as unknown as { __agentOpsRegistry?: { sig: string; reg: Registry } };

/**
 * Cached registry that reloads automatically whenever a manifest is added,
 * edited or removed (checked via a cheap mtime signature on every call).
 */
export function getRegistry(): Registry {
  const dir = agentsDir();
  const sig = signature(dir);
  if (!g.__agentOpsRegistry || g.__agentOpsRegistry.sig !== sig || g.__agentOpsRegistry.reg.dir !== dir) {
    g.__agentOpsRegistry = { sig, reg: loadRegistry(dir) };
  }
  return g.__agentOpsRegistry.reg;
}

export function createManifestFile(id: string, type: "claude-code" | "api-script" | "other" = "claude-code"): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error(`Invalid agent id "${id}"`);
  const dir = agentsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.yaml`);
  if (fs.existsSync(file)) throw new Error(`${id}.yaml already exists`);
  fs.writeFileSync(file, defaultManifestYaml(id, type));
  return file;
}
