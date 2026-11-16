/**
 * Seeds 3 demo agents (+1 unregistered) with ~2 weeks of realistic runs.
 *   npm run seed            # add demo data (idempotent)
 *   npm run seed -- --reset # wipe demo data first
 *   npm run seed -- --remove # remove demo data and demo manifests
 */
import fs from "node:fs";
import path from "node:path";
import { createDb, dbPath } from "../src/lib/db/client";
import { ingestEvents } from "../src/lib/events/ingest";
import { runAlertEngine } from "../src/lib/alerts/engine";
import { loadRegistry, agentsDir } from "../src/lib/registry/registry";
import type { AgentEventInput } from "../src/lib/events/schema";

const DEMO_MANIFESTS: Record<string, string> = {
  "portfolio-research": `# DEMO agent — remove with: npm run seed -- --remove
id: portfolio-research
name: Portfolio Research
description: Twice-daily market scan and portfolio briefing.
owner: me
type: claude-code
schedule: "37 7,18 * * *"
timezone: Asia/Singapore
tags: [demo, finance, scheduled]
expected_runtime_minutes: 12
color: "#6E56CF"
alert_rules:
  - type: consecutive_failures
    threshold: 2
  - type: no_run_within
    hours: 13
    severity: critical
  - type: cost_per_run_exceeds
    usd: 3
`,
  "pr-reviewer": `# DEMO agent — remove with: npm run seed -- --remove
id: pr-reviewer
name: PR Reviewer
description: Reviews pull requests on demand and leaves inline comments.
owner: me
type: claude-code
tags: [demo, code]
expected_runtime_minutes: 8
color: "#0EA5E9"
alert_rules:
  - type: failures_in_window
    threshold: 3
    hours: 24
  - type: runtime_exceeds
    minutes: 25
`,
  "inbox-triage": `# DEMO agent — remove with: npm run seed -- --remove
id: inbox-triage
name: Inbox Triage
description: Labels and drafts replies for new email every 30 minutes on weekdays.
owner: me
type: api-script
schedule: "*/30 8-20 * * 1-5"
timezone: Asia/Singapore
tags: [demo, email, scheduled]
expected_runtime_minutes: 2
color: "#F59E0B"
alert_rules:
  - type: consecutive_failures
    threshold: 2
    severity: critical
  - type: no_run_within
    hours: 3
`,
};
const DEMO_IDS = [...Object.keys(DEMO_MANIFESTS), "scratch-experiments"];

// deterministic PRNG so reseeding produces the same data
let s = 42;
const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const between = (a: number, b: number) => a + rand() * (b - a);

const TOOLS: Record<string, { tool: string; summary: () => string }[]> = {
  "portfolio-research": [
    { tool: "WebSearch", summary: () => pick(["S&P 500 futures today", "STI index close", "NVDA earnings guidance", "US 10y yield", "SGD USD outlook"]) },
    { tool: "WebFetch", summary: () => pick(["https://www.reuters.com/markets/", "https://www.ft.com/markets", "https://www.bloomberg.com/markets"]) },
    { tool: "Read", summary: () => "portfolio/holdings.csv" },
    { tool: "Bash", summary: () => "python analyze.py --window 30d" },
    { tool: "Write", summary: () => "reports/briefing.md" },
  ],
  "pr-reviewer": [
    { tool: "Bash", summary: () => pick(["git diff main...HEAD", "npm test", "gh pr view --json files"]) },
    { tool: "Read", summary: () => pick(["src/api/handlers.ts", "src/lib/auth.ts", "package.json", "src/components/Table.tsx"]) },
    { tool: "Grep", summary: () => pick(["TODO", "console.log", "any\\b"]) },
    { tool: "Edit", summary: () => "review-notes.md" },
  ],
  "inbox-triage": [
    { tool: "gmail.search", summary: () => "is:unread newer_than:1h" },
    { tool: "classify", summary: () => pick(["4 messages", "7 messages", "2 messages"]) },
    { tool: "gmail.label", summary: () => pick(["Finance", "Newsletters", "Action required"]) },
    { tool: "gmail.draft", summary: () => "Re: Invoice #2231" },
  ],
  "scratch-experiments": [
    { tool: "Bash", summary: () => "node experiment.js" },
    { tool: "Read", summary: () => "notes.md" },
  ],
};
const PROMPTS: Record<string, string[]> = {
  "portfolio-research": ["Morning market briefing and portfolio check", "Evening wrap-up: movers and risk check"],
  "pr-reviewer": ["Review PR #412: add rate limiting", "Review PR #415: migrate to new auth client", "Review PR #418: table virtualization", "Review PR #421: fix flaky e2e test"],
  "inbox-triage": ["Triage new email"],
  "scratch-experiments": ["Try out a new prompt for summarising notes"],
};
const ERRORS = ["Rate limited by upstream API (429)", "Timeout fetching https://www.ft.com/markets", "OAuth token expired", "Tool returned non-zero exit code"];

function buildRun(agent: string, runId: string, start: number, opts: { fail?: boolean; running?: boolean; minutes: number; cost: number }): AgentEventInput[] {
  const base = { schema_version: 1 as const, agent_id: agent, run_id: runId, session_id: runId, source: "seed" };
  const ev: AgentEventInput[] = [];
  let t = start;
  let n = 0;
  const id = () => `seed:${runId}:${n++}`;
  ev.push({ ...base, event_type: "run_started", timestamp: t, event_id: id(), payload: { source: "startup" } });
  t += 2000;
  ev.push({ ...base, event_type: "message", timestamp: t, event_id: id(), payload: { role: "user", text: pick(PROMPTS[agent]) } });
  const steps = Math.max(2, Math.round(opts.minutes * between(0.8, 1.6)));
  const totalMs = opts.minutes * 60_000;
  const failAt = opts.fail ? Math.floor(steps * between(0.5, 0.95)) : -1;
  for (let i = 0; i < steps; i++) {
    t += totalMs / (steps + 1);
    if (opts.running && t > Date.now() - 30_000) break;
    const tool = pick(TOOLS[agent]);
    ev.push({ ...base, event_type: "tool_called", timestamp: Math.round(t), event_id: id(), payload: { tool: tool.tool, summary: tool.summary() } });
    const errored = i === failAt || rand() < 0.04;
    ev.push({
      ...base, event_type: "tool_result", timestamp: Math.round(t + between(300, 4000)), event_id: id(),
      status: errored ? "error" : "ok", payload: { tool: tool.tool, output: errored ? pick(ERRORS) : "ok" },
    });
    if (i === failAt) {
      ev.push({ ...base, event_type: "error", timestamp: Math.round(t + 5000), event_id: id(), payload: { message: pick(ERRORS) } });
      t += 6000;
      break;
    }
  }
  if (!opts.running) {
    const end = Math.round(opts.fail ? t + 1000 : start + totalMs);
    const tokensIn = Math.round(opts.cost * 120_000);
    ev.push({
      ...base, event_type: "run_completed", status: opts.fail ? "failed" : "success", timestamp: end, event_id: id(),
      payload: { reason: opts.fail ? "error" : "turn_end" },
      metrics: { tokens_in: tokensIn, tokens_out: Math.round(tokensIn * 0.08), cost_usd: Math.round(opts.cost * 100) / 100 },
    });
  }
  return ev;
}

function generate(now: number): AgentEventInput[] {
  const all: AgentEventInput[] = [];
  const DAY = 86_400_000;
  // Portfolio research: 07:37 and 18:37 SGT (UTC+8) for 14 days
  for (let d = 14; d >= 0; d--) {
    for (const hourUtc of [23.6167, 10.6167]) {
      const day = new Date(now - d * DAY);
      day.setUTCHours(0, 0, 0, 0);
      const start = day.getTime() + hourUtc * 3_600_000 + between(0, 90_000);
      if (start > now) continue;
      const fail = (d === 9 && hourUtc > 20) || (d === 4 && hourUtc < 20);
      all.push(...buildRun("portfolio-research", `pr-${Math.round(start)}`, start, {
        fail, minutes: between(8, 16), cost: d === 2 && hourUtc < 20 ? 3.4 : between(0.6, 1.9),
      }));
    }
  }
  // PR reviewer: on demand, a few per weekday; one currently running
  for (let d = 13; d >= 0; d--) {
    const count = Math.floor(between(1, 5));
    for (let i = 0; i < count; i++) {
      const start = now - d * DAY - between(1, 10) * 3_600_000;
      if (start > now - 600_000) continue;
      all.push(...buildRun("pr-reviewer", `rev-${Math.round(start)}`, start, { fail: rand() < 0.1, minutes: between(3, 11), cost: between(0.2, 0.9) }));
    }
  }
  all.push(...buildRun("pr-reviewer", `rev-live-${Math.floor(now / 60_000)}`, now - 4 * 60_000, { running: true, minutes: 6, cost: 0.4 }));
  // Inbox triage: every 30 min, 08:00–20:00 SGT on weekdays, last 5 days; last two runs failed
  const triageRuns: number[] = [];
  for (let t = now - 5 * DAY; t < now; t += 30 * 60_000) {
    const sgt = new Date(t + 8 * 3_600_000);
    const h = sgt.getUTCHours();
    const wd = sgt.getUTCDay();
    if (h < 8 || h > 20 || wd === 0 || wd === 6) continue;
    triageRuns.push(t - (t % (30 * 60_000)));
  }
  triageRuns.forEach((start, i) => {
    const fail = i >= triageRuns.length - 2 || rand() < 0.03;
    all.push(...buildRun("inbox-triage", `tri-${start}`, start, { fail, minutes: between(0.8, 2.5), cost: between(0.02, 0.08) }));
  });
  // Unregistered agent: shows up as "Unregistered" with a create-manifest action
  for (const h of [30, 6, 2]) {
    const start = now - h * 3_600_000;
    all.push(...buildRun("scratch-experiments", `scr-${Math.round(start)}`, start, { minutes: between(2, 5), cost: between(0.1, 0.3) }));
  }
  return all;
}

const args = process.argv.slice(2);
const db = createDb(dbPath());
const dir = agentsDir();

function wipe() {
  const q = DEMO_IDS.map(() => "?").join(",");
  db.$client.prepare(`DELETE FROM events WHERE agent_id IN (${q})`).run(...DEMO_IDS);
  db.$client.prepare(`DELETE FROM runs WHERE agent_id IN (${q})`).run(...DEMO_IDS);
  db.$client.prepare(`DELETE FROM alerts WHERE agent_id IN (${q})`).run(...DEMO_IDS);
}

if (args.includes("--remove")) {
  wipe();
  for (const id of Object.keys(DEMO_MANIFESTS)) {
    const f = path.join(dir, `${id}.yaml`);
    if (fs.existsSync(f) && fs.readFileSync(f, "utf8").includes("DEMO agent")) fs.rmSync(f);
  }
  console.log("Removed demo agents and their data.");
  process.exit(0);
}
if (args.includes("--reset")) wipe();

fs.mkdirSync(dir, { recursive: true });
for (const [id, yaml] of Object.entries(DEMO_MANIFESTS)) {
  const f = path.join(dir, `${id}.yaml`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, yaml);
}

const now = Date.now();
const events = generate(now).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
let accepted = 0, dup = 0;
for (let i = 0; i < events.length; i += 1000) {
  const r = ingestEvents(db, events.slice(i, i + 1000), now);
  accepted += r.accepted;
  dup += r.duplicates;
  if (r.rejected.length) console.warn(r.rejected.slice(0, 3));
}
const changes = runAlertEngine(db, loadRegistry(dir).agents, now, { fullRegistry: true });
console.log(`Seeded ${accepted} events (${dup} already present) into ${dbPath()}`);
console.log(`Alerts changed: ${changes.length}. Manifests in ${dir}`);
