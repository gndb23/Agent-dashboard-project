# Event schema (v1)

Every agent reports by POSTing JSON to `POST /api/events`. The body is **one event or an array of up to 1000 events**.

> **Stability rule:** v1 only ever gains *optional* fields. Nothing is renamed or removed, so an agent written today keeps working. A breaking change would ship as `schema_version: 2` alongside v1.

## Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `schema_version` | `1` | yes | Always `1`. |
| `agent_id` | string | yes | Lowercase slug `[a-z0-9][a-z0-9._-]*`, ≤100 chars. Matches `agents/<agent_id>.yaml`. |
| `run_id` | string | yes | Groups events into one run. For Claude Code this is the session id. A run belongs to exactly one agent. |
| `event_type` | enum | yes | `run_started` · `tool_called` · `tool_result` · `message` · `error` · `run_completed` · `heartbeat` |
| `timestamp` | ISO-8601 string, or epoch seconds/ms | no | Defaults to receive time. |
| `session_id` | string | no | Free-form session reference. |
| `status` | string | no | On `run_completed`: `success`/`failed`/`cancelled` (aliases: `ok`, `error`, `failure`, `aborted`…). Defaults to `success`. On other events, `error`/`failed` counts as an error. |
| `payload` | object | no | Anything useful. Recognised keys: `title`/`prompt`/`text` (run title and message text), `tool`, `summary`, `message`, `reason`. Truncated above 32 KB. |
| `metrics` | object | no | `tokens_in`, `tokens_out`, `cost_usd`, `duration_ms` (plus any extra numeric keys). |
| `metrics_cumulative` | boolean | no | `false` (default): metrics are **deltas** and are summed into the run. `true`: metrics are **run-to-date totals** and are max-merged. |
| `event_id` | string | no | Client id for idempotency. Re-sending the same `event_id` is a no-op (counted as `duplicates`). |
| `source` | string | no | Emitter, e.g. `claude-code-hook`, `transcript-import`, `my-sdk`. |

Unknown extra top-level fields are accepted and ignored.

## Run lifecycle

- The first event for a new `run_id` creates the run with status `running` (it doesn't have to be `run_started`).
- `run_completed` sets the final status, `ended_at` and `duration_ms` (taken from `metrics.duration_ms` if given, otherwise end minus start).
- Any non-heartbeat event that arrives **after** completion reopens the run. This is how a multi-turn Claude Code session behaves: each turn ends with `Stop`.
- A run that is `running` with no events for 30 minutes is shown as **stalled**.
- Late or out-of-order events (older than the completion time) don't reopen a run.

## Responses

| Status | Meaning |
|---|---|
| `202` | At least one event accepted (or all were duplicates). Body: `{ accepted, duplicates, rejected: [{ index, error }] }` |
| `400` | Body was not JSON, or every event was rejected. `rejected[].error` explains why. |

## Examples

```json
{ "schema_version": 1, "agent_id": "nightly-sync", "run_id": "2026-11-16", "event_type": "run_started", "payload": { "title": "Nightly sync" } }
```

```json
[
  { "schema_version": 1, "agent_id": "nightly-sync", "run_id": "2026-11-16", "event_type": "tool_called", "payload": { "tool": "fetch_orders", "summary": "since=yesterday" } },
  { "schema_version": 1, "agent_id": "nightly-sync", "run_id": "2026-11-16", "event_type": "run_completed", "status": "success",
    "metrics": { "tokens_in": 1200, "tokens_out": 300, "cost_usd": 0.01 } }
]
```

## Other endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/events?limit=40&agent_id=x` | Recent activity (for scripts and debugging). |
| `GET /api/stream` | Server-Sent Events: a small change notification for each update (used by the UI). |
| `GET /api/manifests` | Loaded manifests and manifest errors. |
| `POST /api/manifests` `{ "agent_id": "x" }` | Create a starter manifest for an unregistered agent. |
| `PATCH /api/alerts/:id` `{ "status": "acknowledged" \| "resolved" }` | Update an alert. |
| `GET /api/health` | Liveness check. |
