# Onboarding a new agent (≈5 minutes)

The dashboard also has an interactive version of this guide at **/onboarding**, with copy buttons and real file paths.

## 1. Write a manifest

Create `agents/<agent-id>.yaml`. The file name must equal `id`. The dashboard reloads manifests as soon as the file changes. Files that start with `_` are ignored.

```yaml
id: nightly-sync                 # lowercase slug, must match the file name
name: Nightly Sync               # display name
description: Syncs orders to the warehouse.
owner: me
type: api-script                 # claude-code | api-script | other
schedule: "0 2 * * *"            # optional 5-field cron, shows "next run"
timezone: Asia/Singapore         # optional IANA timezone for the schedule
tags: [ops]
expected_runtime_minutes: 5      # optional, shown for context
color: "#6E56CF"                 # optional
alert_rules:
  - type: consecutive_failures   # N failed runs in a row
    threshold: 2
  - type: failures_in_window     # N failed runs within H hours
    threshold: 3
    hours: 24
  - type: runtime_exceeds        # a running run older than M minutes
    minutes: 30
  - type: no_run_within          # no run started in H hours (missed schedule)
    hours: 26
    severity: critical           # warning (default) | critical
  - type: cost_per_run_exceeds   # latest run cost more than $X
    usd: 2
```

Invalid manifests don't crash anything. They appear in a banner on the Overview with the exact validation error.

**How alerts behave:** rules are checked whenever events arrive and every 60 seconds. An alert opens when its condition becomes true and resolves itself once the condition clears. Acknowledging an alert keeps it visible but marks it as seen. If you resolve an alert by hand while the condition still holds, it reopens on the next check.

## 2. Send events

### Claude Code

1. Run `npm run hook-config` (or `npm run hook-config -- my-agent-id` to pin the id) and paste the output into either
   `<project>/.claude/settings.json` (that project only) or `~/.claude/settings.json` (all projects).
2. By default the agent id is the project folder name, slugified. `My Project` becomes `my-project`.
3. Optional: backfill history with `npm run import:transcripts -- --project <folder>`.

What gets captured: session start and end, each prompt, each tool call and result (errors flagged), notifications, and token usage plus estimated cost, read from the transcript at every `Stop`. The hook never blocks the agent: it uses a 1s network timeout, prints nothing and always exits 0. Set `AGENT_OPS_DEBUG=1` to see its errors.

### Anything else

POST JSON to `http://localhost:4321/api/events` (see [EVENT_SCHEMA.md](EVENT_SCHEMA.md)). The minimum is three events:

```python
report("run_started", payload={"title": "Nightly sync"})
report("tool_called", payload={"tool": "fetch_orders"})      # optional, as many as you like
report("run_completed", status="success", metrics={"cost_usd": 0.01})
```

A complete dependency-free Python helper is on the /onboarding page. Always wrap reporting in try/except with a short timeout, so monitoring can never break the agent.

## 3. Verify

Run the agent once. It shows up live on the Overview. If it shows as **Unregistered**, the `agent_id` in the events doesn't match any manifest. Click **Create manifest** to generate one, then edit it.

## Removing an agent

Delete its manifest. Its history stays in the database and the agent moves to "Unregistered" if it keeps sending events. Its open alerts resolve automatically.
