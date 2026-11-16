/**
 * Builds the read-only workspace the "Ask Agent Ops" assistant works in:
 * data/assistant/ with a CLAUDE.md (its role, read automatically by Claude Code) and JSON
 * snapshots of agents, runs, alerts, usage and the docs. Rewritten before every question.
 */
import fs from "node:fs";
import path from "node:path";
import type { DB } from "../db/client";
import type { Registry } from "../registry/registry";
import { dataDir } from "../settings";
import { getAgentCards, getKpis, listAlerts, summarizeEvent } from "../queries";
import { discoverTasks } from "../claude-tasks/discover";
import { nextScheduledRun } from "../registry/manifest";

export function assistantDir() {
  return path.join(dataDir(), "assistant");
}

export const ASSISTANT_ROLE = `# You are the Agent Ops assistant

You help the owner of this Agent Ops dashboard understand and manage their AI agents.
Everything you need is in this folder. Read the files before answering; never guess numbers.

| File | What's in it |
|---|---|
| \`now.json\` | Current time, time zone, headline numbers |
| \`agents.json\` | Every agent: settings, schedule, next run, status, last run, success rate, open alerts. Agents with \`origin.kind = "claude-task"\` are Claude Desktop scheduled tasks |
| \`runs.json\` | The latest runs (newest first): agent, status, start/end, duration, tools, errors, tokens, cost, title |
| \`errors.json\` | Recent error events and failed tool results with run ids |
| \`alerts.json\` | Open, acknowledged and resolved alerts |
| \`usage-daily.json\` | Runs, failures, cost and tokens per agent per day (last 30 days) |
| \`tasks/<name>.md\` | Full instructions of each Claude scheduled task |
| \`docs/\` | How Agent Ops works: event schema, onboarding, adding agents |

How to answer:
- Be direct and specific. Lead with the answer, then the evidence (run ids, times, numbers).
- Times in \`now.json\`'s time zone, in plain words ("yesterday 08:02").
- Money as $0.00. If a number is an estimate, say so.
- When asked why something failed, look at runs.json and errors.json for that agent and quote the error.
- You can't change anything yourself. To make a change, tell the owner where to click (pages: Overview, Agents, an agent's Settings tab, Runs, Usage, Workflow, Alerts, Settings).

## Creating agents
When the owner wants a new agent, write a short plan and then ONE draft in this exact format, which the dashboard
turns into a "Create this agent" button:

\`\`\`agent
{"name": "Weekly Sales Report", "description": "One line", "schedule": "weekdays 08:00", "instructions": "Step-by-step instructions for the agent, in Markdown.", "tags": ["sales"]}
\`\`\`

\`schedule\` accepts "daily 05:30", "weekdays 08:00", "every 30m", "every 2h", a 5-field cron, or "" for on demand.
Write instructions the agent can follow on its own: goal, inputs (files, folders, sites), steps, where to save results, and what to do on errors.
`;

const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString() : null);

export function writeAssistantContext(db: DB, reg: Registry, now = Date.now()): string {
  const dir = assistantDir();
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  const w = (f: string, v: unknown) => fs.writeFileSync(path.join(dir, f), typeof v === "string" ? v : JSON.stringify(v, null, 2));

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  w("CLAUDE.md", ASSISTANT_ROLE);
  w("now.json", { now: new Date(now).toISOString(), localTime: new Date(now).toLocaleString("en-US", { timeZone: tz }), timeZone: tz, kpis: getKpis(db, now) });

  const cards = getAgentCards(db, reg, now);
  w(
    "agents.json",
    cards.map((c) => {
      const m = c.manifest;
      return {
        id: c.id,
        name: c.name,
        registered: Boolean(m),
        description: m?.description,
        type: m?.type,
        schedule: m?.schedule ?? null,
        timezone: m?.timezone ?? null,
        nextRun: m ? iso(nextScheduledRun(m, new Date(now))?.getTime()) : null,
        status: c.status,
        lastRun: c.lastRun ? { id: c.lastRun.id, status: c.lastRun.status, started: iso(c.lastRun.startedAt), title: c.lastRun.title } : null,
        runs24h: c.runs24h,
        successRate7d: c.successRate7d,
        openAlerts: c.openAlerts,
        workingFolder: m?.project_dir ?? m?.origin?.taskDir ?? null,
        handsWorkTo: m?.triggers ?? [],
        alertRules: m?.alert_rules ?? [],
        origin: m?.origin ? { kind: m.origin.kind, task: m.origin.taskName, enabled: m.origin.enabled, model: m.origin.model } : null,
      };
    }),
  );

  const runs = db.$client.prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT 400`).all() as Record<string, unknown>[];
  w(
    "runs.json",
    runs.map((r) => ({
      id: r.id, agent: r.agent_id, status: r.status, title: r.title, started: iso(r.started_at as number), ended: iso(r.ended_at as number | null),
      durationSec: r.duration_ms ? Math.round((r.duration_ms as number) / 1000) : null, tools: r.tool_count, errors: r.error_count,
      tokensIn: r.tokens_in, tokensOut: r.tokens_out, costUsd: r.cost_usd, triggeredBy: r.parent_run_id ?? null,
    })),
  );

  const errs = db.$client
    .prepare(`SELECT agent_id, run_id, event_type, status, timestamp, payload FROM events WHERE event_type = 'error' OR status IN ('error','failed') ORDER BY timestamp DESC LIMIT 150`)
    .all() as { agent_id: string; run_id: string; event_type: string; status: string | null; timestamp: number; payload: string | null }[];
  w("errors.json", errs.map((e) => ({ agent: e.agent_id, run: e.run_id, at: iso(e.timestamp), what: summarizeEvent(e.event_type, e.payload ? JSON.parse(e.payload) : null, e.status), detail: e.payload ? JSON.parse(e.payload) : null })));

  w("alerts.json", listAlerts(db, undefined, 200).map((a) => ({ ...a, triggeredAt: iso(a.triggeredAt), acknowledgedAt: iso(a.acknowledgedAt), resolvedAt: iso(a.resolvedAt) })));

  const daily = db.$client
    .prepare(
      `SELECT agent_id agent, date(started_at/1000, 'unixepoch', 'localtime') day, COUNT(*) runs, SUM(status='failed') failed,
              ROUND(SUM(cost_usd), 4) costUsd, SUM(tokens_in) tokensIn, SUM(tokens_out) tokensOut
       FROM runs WHERE started_at >= ? GROUP BY 1, 2 ORDER BY 2 DESC, 1`,
    )
    .all(now - 30 * 86_400_000);
  w("usage-daily.json", daily);

  for (const f of fs.readdirSync(path.join(dir, "tasks"))) fs.rmSync(path.join(dir, "tasks", f), { force: true });
  for (const t of discoverTasks().tasks) w(path.join("tasks", `${t.taskName}.md`), `# ${t.title}\n\n${t.description}\n\nFolder: ${t.cwd ?? "(not known)"}\nSchedule (cron, local time): ${t.cron ?? "(not known)"}\n\n## Instructions\n\n${t.instructions}\n`);

  for (const doc of ["EVENT_SCHEMA.md", "ONBOARDING.md"]) {
    const src = path.join(process.cwd(), "docs", doc);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, "docs", doc));
  }
  return dir;
}

/** Pulls ```agent {...}``` drafts out of an assistant reply. */
export function extractAgentDrafts(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of text.matchAll(/```agent\s*\n([\s\S]*?)```/g)) {
    try {
      const o = JSON.parse(m[1]);
      if (o && typeof o === "object" && typeof o.name === "string") out.push(o);
    } catch {
      /* ignore broken draft */
    }
  }
  return out;
}
