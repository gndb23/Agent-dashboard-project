import type { AgentManifest } from "../registry/manifest";
import type { Registry } from "../registry/registry";
import type { DiscoveredTask } from "./discover";
import { slugifyTaskName } from "./discover";
import { missedRunHours } from "../register";

const STOP = new Set(["the", "a", "an", "and", "of", "for", "vs", "to", "agent", "task", "daily", "twice", "sonnet", "opus", "haiku", "fable"]);
const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => w.slice(0, 5)), // light stemming: "gatherer" ≈ "gathering"
  );

/** How well a manifest's name matches a task's title (0..1, overlap of meaningful words). */
export function nameMatch(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  if (shared < 2 && Math.min(A.size, B.size) > 1) return 0;
  return shared / Math.min(A.size, B.size);
}

/**
 * Merges Claude Desktop scheduled tasks into the registry.
 * - A manifest linked to a task (scheduled_task, same id, or a clear name match) is enriched with the
 *   task's real schedule, folder and instructions; your links and alert rules are kept.
 * - Any other task becomes an agent of its own, with no file written ("virtual").
 */
export function mergeTasks(base: Registry, tasks: DiscoveredTask[], localTz: string): Registry {
  const agents = base.agents.map((a) => ({ ...a }));
  const byId = new Map(agents.map((a) => [a.id, a]));
  const linked = new Set<string>();

  const linkTo = (t: DiscoveredTask): AgentManifest | undefined => {
    const explicit = agents.find((a) => a.scheduled_task && slugifyTaskName(a.scheduled_task) === slugifyTaskName(t.taskName));
    if (explicit) return explicit;
    const slug = slugifyTaskName(t.taskName);
    const sameId = byId.get(slug);
    if (sameId && !sameId.scheduled_task) return sameId;
    const free = agents.filter((a) => !a.scheduled_task && !linked.has(a.id));
    // "portfolio-research-agent" is the start of "portfolio-research-agent-twice-daily": the longest such id wins.
    const prefixed = free.filter((a) => slug.startsWith(`${a.id}-`)).sort((x, y) => y.id.length - x.id.length);
    if (prefixed.length) return prefixed[0];
    const raw = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1));
    const rawScore = (a: string, b: string) => {
      const A = raw(a);
      const B = raw(b);
      let n = 0;
      for (const w of A) if (B.has(w)) n++;
      return n / Math.max(A.size, B.size, 1);
    };
    const candidates = free
      .map((a) => ({ a, score: Math.max(nameMatch(a.name, t.title), nameMatch(a.name, t.taskName)), tie: Math.max(rawScore(a.name, t.title), rawScore(a.name, t.taskName)) }))
      .filter((x) => x.score >= 0.8)
      .sort((x, y) => y.score - x.score || y.tie - x.tie);
    if (candidates.length === 1) return candidates[0].a;
    if (candidates.length > 1 && (candidates[0].score > candidates[1].score || candidates[0].tie > candidates[1].tie)) return candidates[0].a;
    return undefined;
  };

  for (const t of tasks) {
    const origin = {
      kind: "claude-task" as const,
      taskName: t.taskName,
      taskDir: t.taskDir,
      skillFile: t.skillFile,
      instructions: t.instructions,
      enabled: t.enabled,
      model: t.model,
      permissionMode: t.permissionMode,
    };
    const m = linkTo(t);
    if (m && !linked.has(m.id)) {
      linked.add(m.id);
      m.origin = { ...origin, virtual: false, cronSource: t.cron ? "app" : m.schedule ? "manifest" : "none" };
      if (t.cron) {
        m.schedule = t.cron;
        m.timezone = localTz;
      }
      if (!m.project_dir && t.cwd) m.project_dir = t.cwd;
      if (!m.description && t.description) m.description = t.description;
      m.type = "claude-code";
      continue;
    }
    let id = slugifyTaskName(t.taskName) || "claude-task";
    if (byId.has(id)) id = `${id}-task`;
    const rules: AgentManifest["alert_rules"] = [{ type: "consecutive_failures", threshold: 2, severity: "warning" }];
    if (t.cron && t.enabled !== false) rules.push({ type: "no_run_within", hours: missedRunHours(t.cron, localTz), severity: "warning" });
    const agent: AgentManifest = {
      id,
      name: t.title,
      description: t.description,
      owner: "",
      type: "claude-code",
      schedule: t.cron,
      timezone: t.cron ? localTz : undefined,
      tags: ["claude-task"],
      alert_rules: rules,
      triggers: [],
      extra_dirs: [],
      project_dir: t.cwd,
      scheduled_task: t.taskName,
      origin: { ...origin, virtual: true, cronSource: t.cron ? "app" : "none" },
    };
    agents.push(agent);
    byId.set(id, agent);
  }

  // Paused tasks shouldn't raise "missed run" alerts.
  for (const a of agents) if (a.origin?.enabled === false) a.alert_rules = a.alert_rules.filter((r) => r.type !== "no_run_within");

  // Re-check links now that task agents exist.
  const errors = base.errors.filter((e) => !e.error.startsWith("triggers references"));
  for (const a of agents) {
    const bad = a.triggers.filter((t) => t === a.id || !byId.has(t));
    if (bad.length) errors.push({ file: `${a.id}.yaml`, error: `triggers references ${bad.map((b) => (b === a.id ? `itself ("${b}")` : `unknown agent "${b}"`)).join(", ")} (the agent still loads; the link is ignored)` });
  }
  agents.sort((x, y) => x.name.localeCompare(y.name));
  return { ...base, agents, byId, errors };
}
