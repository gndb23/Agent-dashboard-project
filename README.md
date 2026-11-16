# Agent Ops

One place to **see, ask about, create and run** all your AI agents. It runs on your own computer at `http://localhost:4321`.

- Your **Claude scheduled tasks appear automatically**, with their schedules, folders, instructions and run history. New tasks you make in the Claude app show up within seconds.
- **Ask anything** (Ctrl+K): "what failed overnight?", "what did I spend this week?", "create an agent that…".
- **Chat with any agent**: it knows its instructions and can read the files in its folders.
- **Create, edit and run agents** from the browser, with no files and no terminal.

![Overview](docs/screenshot-overview.png)

## Get started on Windows (no terminal)

Open the **Claude desktop app → Code tab**, and send this message:

> Set up Agent Ops on this PC. If `C:\dev\Agent-dashboard-project` doesn't exist, clone https://github.com/gndb23/Agent-dashboard-project.git into it and check out the branch `claude/sleepy-thompson-bpxvlh`. Then run `powershell -NoProfile -ExecutionPolicy Bypass -File C:\dev\Agent-dashboard-project\scripts\windows\install.ps1` and tell me what it printed.

That one-time setup:
- installs Node.js if it's missing;
- installs and builds Agent Ops;
- connects it to Claude Code;
- makes it **start by itself, invisibly, whenever you log in**;
- puts an **Agent Ops** shortcut on your desktop;
- opens the dashboard.

After that, **double-click "Agent Ops"** on your desktop any time. Updates are one click in **Settings → Updates**.

If something isn't right, open **Settings → Health**. Each problem has a one-click fix, such as logging in to Claude or installing the reporting hooks.

<details>
<summary>macOS / Linux, or running it by hand</summary>

```bash
./start.sh                 # installs, builds, starts in the background, opens the browser
# or, for development:
npm install && npm run dev # http://localhost:4321
```

Requirements: Node.js 22.13 or newer (its built-in SQLite is the database, so nothing needs compiling). Everything is local: SQLite (`data/agent-ops.db`), no external services.
</details>

## What you get

| Page | What it's for |
|---|---|
| **Overview** | Headline numbers, a card per agent with its recent runs, a live activity feed, and "What's happening?" |
| **Agents** | Every agent in a table: status, last and next run, success rate, cost, and a **Run** button |
| **Agent** | Charts, run history, alerts, instructions, and a **chat panel**. **Run now**, **Settings**, **Ask about this agent** |
| **New agent** | A 5-step wizard. Describe the agent in plain words and AI fills it in, or fill it in yourself |
| **Runs** | Every run, filterable by agent, status, time and text. Each run shows its timeline and what it reported |
| **Workflow** | Which agent hands work to which, from links you set and handoffs that actually happened |
| **Usage** | Cost and tokens per day and per agent, and the most expensive runs |
| **Alerts** | Failures in a row, missed scheduled runs, slow or expensive runs. They auto-resolve |
| **Settings** | Health with one-click fixes, Claude login, updates, scheduled-task folders, notifications, demo data |

**Ctrl+K** opens a command bar on every page: jump anywhere, or type a question and press Enter to ask it.

## How your Claude scheduled tasks are picked up

The Claude desktop app keeps each local scheduled task's instructions in `~/.claude/scheduled-tasks/<task>/SKILL.md`. It keeps the schedule, working folder and on/off state in its own settings file, and runs each task as a normal Claude Code session.

Agent Ops reads all three:
- **Instructions and description** come from `SKILL.md`. Editing the instructions in the agent's Settings writes back to that file, so the next run uses them.
- **Schedule, working folder, model and paused state** come from the app's settings file. To change the schedule, use the Claude app; it updates here within a minute.
- **Runs** are imported from Claude Code's session history every 2 minutes, matched to the right task by its name and instructions. With the reporting hooks installed, they also stream in live.

If an agent file in `agents/` already describes a task (same id, `scheduled_task: <name>`, or a clearly matching name), the two are merged. Your links and alert rules are kept.

**Settings → Claude scheduled tasks** shows which folders were searched and what was found. You can add a folder there if your tasks live elsewhere.

## Chat and runs: what an agent can do

- **Chat** runs Claude Code in the agent's working folder. It has the agent's instructions as background and can read its folders, plus any you add under "Other folders it can read". By default it can read and answer but not change anything. Change that per agent in **Settings → Permissions**.
- **Run now** (and the optional built-in schedule) runs the agent's instructions once and records it as a normal run with its tools, result and cost. Runs have a time limit and can be stopped.
- **Safety:** the dashboard listens on `127.0.0.1` only. Anything that runs commands refuses requests that aren't from `localhost` on the same page.

## For any other agent

Any program can report to Agent Ops by POSTing JSON to `http://localhost:4321/api/events`. See [docs/EVENT_SCHEMA.md](docs/EVENT_SCHEMA.md) and the **Add an agent** guide (`/onboarding`). Claude Code projects report through hooks, which **Settings → Health → Install hooks** sets up.

## How it works

```
 Claude scheduled tasks ─(SKILL.md + app settings)─┐
 Claude Code sessions ──(hooks, live) ──────────────┤
 Claude Code history ───(import every 2 min) ───────┼──► SQLite (runs · events · alerts · chats)
 Any program ───────────(POST /api/events) ─────────┘          │
                                                                ├─► alerts, usage, workflow
 agents/*.yaml (your settings) ──► registry ◄── merged ─────────┤
                                                                └─► live updates (SSE) ──► browser
 Ask · Chat · Run now ──► Claude Code CLI on this computer (claude -p), in the agent's folder
```

- **Background launcher** (`scripts/supervisor.mjs`): installs and builds on first run, shows a "getting ready" page meanwhile, restarts the server if it crashes, and performs in-app updates. Logs are in `data/logs/`.
- **Registry**: manifests in `agents/` plus discovered Claude tasks. Both are validated, hot-reloaded, and editable from the UI, with comments preserved.
- **Event contract** (v1, add-only): batches, duplicate-safe ids, delta or cumulative metrics, parent runs for handoffs.

## Developer commands

| Command | Purpose |
|---|---|
| `npm run dev` / `npm start` | Run on :4321 (development / production) |
| `npm run start:bg` | The background launcher (what the desktop shortcut uses) |
| `npm test` / `npm run typecheck` | Unit tests / TypeScript |
| `npm run build && npm run smoke` | Production build + end-to-end smoke test (fake Claude CLI) |
| `npm run register` | Terminal version of the New-agent wizard |
| `npm run seed` | Demo data (`--reset`, `--remove`) |
| `npm run import:transcripts` | One-off history import (`--since 7`, `--project name`) |
| `npm run install-hooks` | Install the Claude Code reporting hooks for all projects |

Environment variables:

| Group | Variables |
|---|---|
| Storage | `AGENT_OPS_DB`, `AGENT_OPS_DATA_DIR`, `AGENT_OPS_AGENTS_DIR` |
| Claude tasks and CLI | `AGENT_OPS_TASK_DIRS`, `AGENT_OPS_CLAUDE_APP_DIR`, `AGENT_OPS_CLAUDE_BIN` |
| Hook | `AGENT_OPS_URL`, `AGENT_ID`, `AGENT_OPS_PARENT_RUN_ID`, `AGENT_OPS_PARENT_AGENT_ID`, `AGENT_OPS_SKIP_HOOK`, `AGENT_OPS_DEBUG` |

CI (`.github/workflows/ci.yml`) runs the tests, build and smoke test on Windows and Ubuntu, plus the Windows installer itself.

## Project layout

```
agents/                    your agent settings (YAML) — optional; Claude tasks need none
docs/                      EVENT_SCHEMA.md, ONBOARDING.md, screenshots
integrations/claude-code/  hook.mjs (reports Claude Code sessions)
scripts/                   supervisor.mjs, windows/ (install, launch, open, uninstall), smoke, seed, register
src/lib/                   claude/ (CLI runner), claude-tasks/ (discovery, matching, history), assistant/, runner/,
                           chat/, registry/, events/, alerts/, system/, db/, queries.ts
src/app/                   pages and api/ routes
tests/                     unit tests (vitest)
```

## Restyling

All colours, the type scale, radii, shadows and fonts are design tokens in `src/app/globals.css`, with light and dark sets. Status colours are chosen to stay distinguishable for colour-blind viewers.
