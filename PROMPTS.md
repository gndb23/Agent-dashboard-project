# Plan: Prompt for an Agent Monitoring Dashboard

## Context
You want a professional 2D dashboard that tracks all your agent workflows and makes it easy to add agents you build later. The repo `Agent-dashboard-project` is empty. Your choices:
- **What it monitors:** Claude Code sessions, including scheduled ones such as the portfolio research agent.
- **Where it runs:** a local web app.
- **How new agents join:** a manifest file plus a small reporting snippet.

This plan delivers two prompts (build, then polish) and my view on splitting the work between Opus and Fable.

## My view on Opus to build, then Fable to polish
The split works, but I'd make two changes:
1. **Put the design brief in the first prompt.** If Opus builds a layout with no visual direction, Fable has to tear it apart. If Opus builds on a defined token and theme system (colors, spacing, type, dark mode), Fable's pass is refinement, not a rewrite. That makes it cheaper and keeps the logic intact.
2. **Opus 5.5 is a good fit for the build.** It writes strong code at half Fable 5.2's price ($4/$20 vs $8/$40 per million tokens). Fable 5.2 is the more capable model overall, so use it where judgment counts: visual polish, hierarchy, micro-interactions and a critique of the UX. Tell Fable explicitly **not to change** the data layer or the event contract, so the polish can't break anything.

Optional: run Opus at high effort for the build. At Fable's start, give it screenshots of the current UI. It reasons better from visuals than from code alone.

## How Claude Code sessions report in
The SDK needs no code changes inside agents:
- **Claude Code hooks** (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `Notification`) run a tiny script that POSTs JSON to `http://localhost:<port>/api/events`.
- **Backfill/history** comes from parsing the local transcripts in `~/.claude/projects/**/*.jsonl`.
- **Caveat:** cloud sessions run remotely, so hooks there can't reach your localhost. Phase 1 is local sessions only. Cloud sessions need either a tunnel or hosting the dashboard later; the build prompt says so.

---

## PROMPT 1: Build (give to Opus)

```
You are building "Agent Ops", a local, professional 2D web dashboard that monitors my AI agent workflows. Today it monitors Claude Code sessions; it must make onboarding future agents trivial.

## Stack
- Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, Recharts for charts.
- SQLite via Drizzle ORM (single file DB, no external services).
- Real-time updates via Server-Sent Events.
- Runs with `npm run dev` / `npm start` on localhost:4321.

## Core concept: the Agent Registry (most important part)
Every agent is defined by a manifest file in `agents/<agent-id>.yaml`:
  id, name, description, owner, type (claude-code | api-script | other),
  schedule (optional cron), tags, expected_runtime_minutes,
  alert_rules (e.g. fail_count >= 2, runtime > N min, no run in X hours),
  icon/color (optional).
- The app watches `agents/` and auto-registers new manifests. No code changes to onboard an agent.
- Unknown agents that send events appear as "Unregistered" with a one-click "create manifest" action.
- Validate manifests with Zod; show clear errors in the UI.

## Event contract (versioned, stable, documented)
POST /api/events accepts:
  { schema_version: 1, agent_id, run_id, session_id?, event_type
    (run_started | tool_called | tool_result | message | error | run_completed | heartbeat),
    timestamp, status?, payload (free JSON), metrics? { tokens_in, tokens_out, cost_usd, duration_ms } }
- Write it to `docs/EVENT_SCHEMA.md`. Never break this contract; add fields only.

## Claude Code integration (ship these)
1. `integrations/claude-code/hook.sh` (or .mjs): reads hook JSON from stdin and posts it to /api/events.
   Map SessionStart→run_started, PreToolUse→tool_called, PostToolUse→tool_result,
   Stop/SubagentStop→run_completed, Notification→message. agent_id comes from an env var
   AGENT_ID, else the project folder name.
2. A sample `.claude/settings.json` hooks block that wires it up.
3. `scripts/import-transcripts.ts`: backfills history from ~/.claude/projects/**/*.jsonl (idempotent).
4. A README note: cloud sessions can't reach localhost; document a future tunnel/hosted option.
Hooks must never block or slow the agent: fire-and-forget, 1s timeout, silent on failure.

## Screens
1. Overview: KPI row (active now, runs today, success rate, failures 24h, est. cost),
   live activity feed, agent status grid (card per agent: status dot, last run, next scheduled run, sparkline).
2. Agent detail: run history table, success/duration/cost trends, manifest view, alert rules.
3. Run detail: timeline of events (tool calls, results, errors) with expandable JSON payloads.
4. Alerts: triggered alerts, acknowledged/resolved state.
5. Onboarding: step-by-step "add a new agent" guide with copy-paste snippets.

## Design foundation (a designer will polish later, so make it easy to restyle)
- All colors, spacing, radius and typography as CSS variables / Tailwind theme tokens; no hard-coded colors in components.
- Dark mode first, light mode supported. Clean, dense, "ops console" feel (think Linear/Vercel/Datadog).
- Status colors: success, running, warning, failed, idle, each defined once.
- Keep components presentational vs. data-fetching separated.

## Quality bar
- Seed script with 3 demo agents and realistic fake runs so the UI is never empty.
- Unit tests for manifest validation, event ingestion and alert rules.
- `docs/ONBOARDING.md`: adding a new agent in under 5 minutes.
- Before finishing: run the app, ingest the sample events, verify every screen renders, run tests.

Work in phases: (1) data model + event API + registry, (2) Claude Code hook + importer,
(3) UI screens, (4) alerts, (5) docs + tests. Show me the schema and folder structure before writing UI code.
```

## PROMPT 2: Polish (give to Fable, after Prompt 1 is done)

```
You are a senior product designer-engineer. This repo contains "Agent Ops", a working local dashboard
for monitoring AI agents. Your job is to make it look and feel world-class and professional, in 2D.

Hard constraints:
- Do NOT change the database schema, /api/events contract, manifest format, hooks or business logic.
- Work through the existing theme tokens and components; refine them rather than replacing the architecture.
- All tests must still pass.

Do:
1. Run the app, screenshot every screen (dark + light), and write a short critique first:
   hierarchy, density, alignment, consistency, empty/loading/error states.
2. Refine the design system: color palette (accessible contrast, distinct status colors),
   typography scale, spacing rhythm, elevation, iconography.
3. Elevate key moments: KPI row, agent status grid, live activity feed, run timeline.
   Add tasteful motion (status pulses for running agents, smooth list updates), with no gimmicks.
4. Polish empty, loading (skeletons) and error states, plus responsive layout down to laptop width.
5. Make onboarding feel delightful: clear steps, copy buttons, a "waiting for first event…" live check.
6. Re-screenshot and show before/after for each screen.
```

## Verification (after each prompt)
- `npm run dev`. The Overview loads with seeded agents.
- Wire the hook into one real Claude Code project, run a session and watch it appear live.
- Add a new `agents/test.yaml`. It shows up without a restart.
- `npm test` passes, and still passes after Fable's polish.
