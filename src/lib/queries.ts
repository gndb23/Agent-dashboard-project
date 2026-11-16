import type { DB } from "./db/client";
import type { Alert, Run, RunStatus } from "./db/schema";
import { nextScheduledRun, type AgentManifest } from "./registry/manifest";
import type { Registry } from "./registry/registry";

export const ACTIVE_WINDOW_MS = 30 * 60_000;
const DAY = 86_400_000;

/** Visual status vocabulary — maps 1:1 to the status design tokens. */
export type DisplayStatus = "success" | "running" | "warning" | "failed" | "idle";

export type RunView = Run & { displayStatus: DisplayStatus; stalled: boolean };

type RunRow = {
  id: string; agent_id: string; session_id: string | null; status: RunStatus; title: string | null;
  started_at: number; ended_at: number | null; last_event_at: number; duration_ms: number | null;
  tokens_in: number; tokens_out: number; cost_usd: number; event_count: number; tool_count: number; error_count: number;
  parent_run_id: string | null; parent_agent_id: string | null;
};

function toRun(r: RunRow, now: number): RunView {
  const stalled = r.status === "running" && now - r.last_event_at > ACTIVE_WINDOW_MS;
  const displayStatus: DisplayStatus =
    r.status === "running" ? (stalled ? "warning" : "running")
    : r.status === "failed" ? "failed"
    : r.status === "cancelled" ? "idle"
    : "success";
  return {
    id: r.id, agentId: r.agent_id, sessionId: r.session_id, status: r.status, title: r.title,
    startedAt: r.started_at, endedAt: r.ended_at, lastEventAt: r.last_event_at, durationMs: r.duration_ms,
    tokensIn: r.tokens_in, tokensOut: r.tokens_out, costUsd: r.cost_usd, eventCount: r.event_count,
    toolCount: r.tool_count, errorCount: r.error_count,
    parentRunId: r.parent_run_id ?? null, parentAgentId: r.parent_agent_id ?? null, displayStatus, stalled,
  };
}

export function startOfToday(now: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ---------------------------------------------------------------- overview

export type Kpis = {
  activeNow: number;
  runsToday: number;
  successRate24h: number | null;
  completed24h: number;
  failures24h: number;
  cost24h: number;
  openAlerts: number;
};

export function getKpis(db: DB, now = Date.now()): Kpis {
  const s = db.$client;
  const since24 = now - DAY;
  const activeNow = (s.prepare(`SELECT COUNT(*) c FROM runs WHERE status='running' AND last_event_at > ?`).get(now - ACTIVE_WINDOW_MS) as { c: number }).c;
  const runsToday = (s.prepare(`SELECT COUNT(*) c FROM runs WHERE started_at >= ?`).get(startOfToday(now)) as { c: number }).c;
  const agg = s
    .prepare(
      `SELECT SUM(status='success') ok, SUM(status='failed') bad, COALESCE(SUM(cost_usd),0) cost
       FROM runs WHERE started_at >= ?`,
    )
    .get(since24) as { ok: number | null; bad: number | null; cost: number };
  const ok = agg.ok ?? 0;
  const bad = agg.bad ?? 0;
  const openAlerts = (s.prepare(`SELECT COUNT(*) c FROM alerts WHERE status='open'`).get() as { c: number }).c;
  return {
    activeNow,
    runsToday,
    completed24h: ok + bad,
    successRate24h: ok + bad > 0 ? ok / (ok + bad) : null,
    failures24h: bad,
    cost24h: agg.cost,
    openAlerts,
  };
}

// ---------------------------------------------------------------- agents

export type AgentCard = {
  id: string;
  manifest: AgentManifest | null; // null → unregistered
  name: string;
  status: DisplayStatus;
  lastRun: RunView | null;
  recentRuns: RunView[]; // newest first, max 24
  runs24h: number;
  successRate7d: number | null;
  nextRunAt: number | null;
  openAlerts: number;
  lastSource: string | null;
};

export function getAgentCards(db: DB, registry: Registry, now = Date.now()): AgentCard[] {
  const s = db.$client;
  const seen = s.prepare(`SELECT DISTINCT agent_id id FROM runs`).all() as { id: string }[];
  const ids = new Set<string>([...registry.agents.map((a) => a.id), ...seen.map((r) => r.id)]);
  const recentStmt = s.prepare(`SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 24`);
  const statsStmt = s.prepare(
    `SELECT SUM(started_at >= @d1) runs24h, SUM(status='success' AND started_at >= @d7) ok, SUM(status='failed' AND started_at >= @d7) bad
     FROM runs WHERE agent_id = @id`,
  );
  const alertStmt = s.prepare(`SELECT COUNT(*) c FROM alerts WHERE agent_id = ? AND status='open'`);
  const sourceStmt = s.prepare(
    `SELECT json_extract(payload,'$._source') src FROM events WHERE agent_id = ? ORDER BY id DESC LIMIT 1`,
  );

  const cards: AgentCard[] = [];
  for (const id of ids) {
    const manifest = registry.byId.get(id) ?? null;
    const recentRuns = (recentStmt.all(id) as RunRow[]).map((r) => toRun(r, now));
    const st = statsStmt.get({ id, d1: now - DAY, d7: now - 7 * DAY }) as { runs24h: number | null; ok: number | null; bad: number | null };
    const ok = st.ok ?? 0;
    const bad = st.bad ?? 0;
    const openAlerts = (alertStmt.get(id) as { c: number }).c;
    const lastRun = recentRuns[0] ?? null;
    const lastDone = recentRuns.find((r) => r.status !== "running");
    const anyActive = recentRuns.some((r) => r.displayStatus === "running");
    const status: DisplayStatus = anyActive
      ? "running"
      : lastDone?.status === "failed"
        ? "failed"
        : openAlerts > 0 || lastRun?.stalled
          ? "warning"
          : lastRun
            ? "success"
            : "idle";
    cards.push({
      id,
      manifest,
      name: manifest?.name ?? id,
      status,
      lastRun,
      recentRuns,
      runs24h: st.runs24h ?? 0,
      successRate7d: ok + bad > 0 ? ok / (ok + bad) : null,
      nextRunAt: manifest ? (nextScheduledRun(manifest, new Date(now))?.getTime() ?? null) : null,
      openAlerts,
      lastSource: ((sourceStmt.get(id) as { src: string | null } | undefined)?.src) ?? null,
    });
  }
  const order: Record<DisplayStatus, number> = { failed: 0, warning: 1, running: 2, success: 3, idle: 4 };
  return cards.sort(
    (a, b) =>
      Number(!a.manifest) - Number(!b.manifest) ||
      order[a.status] - order[b.status] ||
      (b.lastRun?.startedAt ?? 0) - (a.lastRun?.startedAt ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------- activity

export type ActivityItem = {
  id: number;
  agentId: string;
  runId: string;
  eventType: string;
  status: string | null;
  timestamp: number;
  summary: string;
};

export function summarizeEvent(eventType: string, payload: Record<string, unknown> | null, status: string | null): string {
  const p = payload ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const clip = (v: string, n = 90) => (v.length > n ? v.slice(0, n - 1) + "…" : v);
  switch (eventType) {
    case "run_started":
      return str(p.title) ? `Started: ${clip(str(p.title)!)}` : `Run started${str(p.source) ? ` (${p.source})` : ""}`;
    case "tool_called": {
      const tool = str(p.tool) ?? str(p.tool_name) ?? "tool";
      const detail = str(p.summary) ?? str(p.command) ?? str(p.file_path) ?? str(p.pattern) ?? str(p.url);
      return detail ? `${tool} · ${clip(detail, 70)}` : tool;
    }
    case "tool_result": {
      const tool = str(p.tool) ?? str(p.tool_name) ?? "tool";
      return `${tool} ${status === "error" ? "returned an error" : "completed"}`;
    }
    case "message":
      return clip(str(p.text) ?? str(p.prompt) ?? str(p.message) ?? "Message");
    case "error":
      return clip(str(p.message) ?? str(p.error) ?? "Error");
    case "run_completed":
      return `Run ${status ?? "completed"}${str(p.reason) ? ` · ${p.reason}` : ""}`;
    case "heartbeat":
      return "Heartbeat";
    default:
      return eventType;
  }
}

export function getActivity(db: DB, opts: { limit?: number; agentId?: string } = {}): ActivityItem[] {
  const limit = Math.min(opts.limit ?? 40, 200);
  const rows = (
    opts.agentId
      ? db.$client.prepare(`SELECT * FROM events WHERE agent_id = ? AND event_type != 'heartbeat' ORDER BY timestamp DESC, id DESC LIMIT ?`).all(opts.agentId, limit)
      : db.$client.prepare(`SELECT * FROM events WHERE event_type != 'heartbeat' ORDER BY timestamp DESC, id DESC LIMIT ?`).all(limit)
  ) as { id: number; agent_id: string; run_id: string; event_type: string; status: string | null; timestamp: number; payload: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    runId: r.run_id,
    eventType: r.event_type,
    status: r.status,
    timestamp: r.timestamp,
    summary: summarizeEvent(r.event_type, r.payload ? JSON.parse(r.payload) : null, r.status),
  }));
}

// ---------------------------------------------------------------- agent detail

export type DailyPoint = { day: string; ts: number; success: number; failed: number; other: number; avgDurationMin: number | null; cost: number };

export function getAgentRuns(db: DB, agentId: string, now = Date.now(), limit = 100): RunView[] {
  return (db.$client.prepare(`SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?`).all(agentId, limit) as RunRow[]).map((r) => toRun(r, now));
}

export function getAgentDaily(db: DB, agentId: string, days = 14, now = Date.now()): DailyPoint[] {
  const start = startOfToday(now) - (days - 1) * DAY;
  const rows = db.$client
    .prepare(`SELECT status, started_at, duration_ms, cost_usd FROM runs WHERE agent_id = ? AND started_at >= ?`)
    .all(agentId, start) as { status: RunStatus; started_at: number; duration_ms: number | null; cost_usd: number }[];
  const points: (DailyPoint & { _dur: number[] })[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    points.push({
      day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      ts: d.getTime(), success: 0, failed: 0, other: 0, avgDurationMin: null, cost: 0, _dur: [],
    });
  }
  for (const r of rows) {
    const idx = points.findLastIndex((p) => p.ts <= r.started_at);
    if (idx < 0) continue;
    const p = points[idx];
    if (r.status === "success") p.success++;
    else if (r.status === "failed") p.failed++;
    else p.other++;
    p.cost += r.cost_usd;
    if (r.duration_ms != null) p._dur.push(r.duration_ms);
  }
  return points.map(({ _dur, ...p }) => ({
    ...p,
    cost: Math.round(p.cost * 100) / 100,
    avgDurationMin: _dur.length ? Math.round((_dur.reduce((a, b) => a + b, 0) / _dur.length / 60_000) * 10) / 10 : null,
  }));
}

// ---------------------------------------------------------------- run detail

export type TimelineEvent = {
  id: number;
  eventType: string;
  status: string | null;
  timestamp: number;
  payload: Record<string, unknown> | null;
  metrics: Record<string, number> | null;
  summary: string;
};

/** Runs that were triggered by the given run (agent-to-agent handoffs). */
export function getChildRuns(db: DB, runId: string, now = Date.now()): RunView[] {
  return (db.$client.prepare(`SELECT * FROM runs WHERE parent_run_id = ? ORDER BY started_at ASC LIMIT 50`).all(runId) as RunRow[]).map((r) => toRun(r, now));
}

export function getRun(db: DB, runId: string, now = Date.now()): { run: RunView; events: TimelineEvent[] } | null {
  const row = db.$client.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | undefined;
  if (!row) return null;
  const evs = db.$client
    .prepare(`SELECT * FROM events WHERE run_id = ? ORDER BY timestamp ASC, id ASC LIMIT 5000`)
    .all(runId) as { id: number; event_type: string; status: string | null; timestamp: number; payload: string | null; metrics: string | null }[];
  return {
    run: toRun(row, now),
    events: evs.map((e) => {
      const payload = e.payload ? JSON.parse(e.payload) : null;
      return {
        id: e.id,
        eventType: e.event_type,
        status: e.status,
        timestamp: e.timestamp,
        payload,
        metrics: e.metrics ? JSON.parse(e.metrics) : null,
        summary: summarizeEvent(e.event_type, payload, e.status),
      };
    }),
  };
}

// ---------------------------------------------------------------- alerts

export function listAlerts(db: DB, status?: "open" | "acknowledged" | "resolved", limit = 200): Alert[] {
  const rows = (
    status
      ? db.$client.prepare(`SELECT * FROM alerts WHERE status = ? ORDER BY triggered_at DESC LIMIT ?`).all(status, limit)
      : db.$client.prepare(`SELECT * FROM alerts ORDER BY (status='resolved'), triggered_at DESC LIMIT ?`).all(limit)
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    agentId: r.agent_id as string,
    ruleKey: r.rule_key as string,
    ruleType: r.rule_type as string,
    severity: r.severity as "warning" | "critical",
    message: r.message as string,
    status: r.status as Alert["status"],
    runId: (r.run_id as string | null) ?? null,
    triggeredAt: r.triggered_at as number,
    acknowledgedAt: (r.acknowledged_at as number | null) ?? null,
    resolvedAt: (r.resolved_at as number | null) ?? null,
  }));
}

export function alertCounts(db: DB): { open: number; acknowledged: number } {
  const r = db.$client
    .prepare(`SELECT SUM(status='open') open, SUM(status='acknowledged') ack FROM alerts`)
    .get() as { open: number | null; ack: number | null };
  return { open: r.open ?? 0, acknowledged: r.ack ?? 0 };
}

// ---------------------------------------------------------------- workflow graph

export type WorkflowEdge = {
  from: string;
  to: string;
  /** declared = in a manifest's `triggers`; detected = seen in parent_run_id events; both = declared and observed. */
  kind: "declared" | "detected" | "both";
  handoffs7d: number;
  handoffsTotal: number;
  lastHandoffAt: number | null;
};

export function getWorkflowEdges(db: DB, registry: Registry, now = Date.now()): WorkflowEdge[] {
  const edges = new Map<string, WorkflowEdge>();
  for (const a of registry.agents) {
    for (const t of a.triggers) {
      if (t === a.id || !registry.byId.has(t)) continue;
      edges.set(`${a.id}\u0000${t}`, { from: a.id, to: t, kind: "declared", handoffs7d: 0, handoffsTotal: 0, lastHandoffAt: null });
    }
  }
  const rows = db.$client
    .prepare(
      `SELECT parent_agent_id src, agent_id dst, COUNT(*) total, SUM(started_at >= ?) c7, MAX(started_at) last
       FROM runs WHERE parent_agent_id IS NOT NULL AND parent_agent_id != agent_id GROUP BY 1, 2`,
    )
    .all(now - 7 * DAY) as { src: string; dst: string; total: number; c7: number | null; last: number }[];
  for (const r of rows) {
    const key = `${r.src}\u0000${r.dst}`;
    const existing = edges.get(key);
    edges.set(key, {
      from: r.src, to: r.dst, kind: existing ? "both" : "detected",
      handoffs7d: r.c7 ?? 0, handoffsTotal: r.total, lastHandoffAt: r.last,
    });
  }
  return [...edges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

// ---------------------------------------------------------------- runs explorer

export type RunFilter = { agentId?: string; status?: string; sinceMs?: number; q?: string; limit?: number; offset?: number };

export function searchRuns(db: DB, f: RunFilter, now = Date.now()): { runs: RunView[]; total: number } {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.agentId) (where.push("agent_id = ?"), args.push(f.agentId));
  if (f.status === "stalled") (where.push("status = 'running' AND last_event_at < ?"), args.push(now - ACTIVE_WINDOW_MS));
  else if (f.status) (where.push("status = ?"), args.push(f.status));
  if (f.sinceMs) (where.push("started_at >= ?"), args.push(f.sinceMs));
  if (f.q) (where.push("(title LIKE ? OR id LIKE ? OR agent_id LIKE ?)"), args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`));
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.$client.prepare(`SELECT COUNT(*) c FROM runs ${w}`).get(...args) as { c: number }).c;
  const rows = db.$client.prepare(`SELECT * FROM runs ${w} ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(...args, f.limit ?? 50, f.offset ?? 0) as RunRow[];
  return { runs: rows.map((r) => toRun(r, now)), total };
}

// ---------------------------------------------------------------- usage

export type UsageRow = { agentId: string; runs: number; failed: number; cost: number; tokensIn: number; tokensOut: number; avgDurationMs: number | null };

export function usageByAgent(db: DB, sinceMs: number): UsageRow[] {
  return (db.$client
    .prepare(
      `SELECT agent_id agentId, COUNT(*) runs, SUM(status='failed') failed, COALESCE(SUM(cost_usd),0) cost,
              COALESCE(SUM(tokens_in),0) tokensIn, COALESCE(SUM(tokens_out),0) tokensOut, AVG(duration_ms) avgDurationMs
       FROM runs WHERE started_at >= ? GROUP BY agent_id ORDER BY cost DESC, runs DESC`,
    )
    .all(sinceMs) as UsageRow[]).map((r) => ({ ...r, failed: r.failed ?? 0 }));
}

export function usageDaily(db: DB, days: number, now = Date.now()): { day: string; ts: number; cost: number; runs: number; failed: number; tokens: number }[] {
  const start = startOfToday(now) - (days - 1) * DAY;
  const rows = db.$client.prepare(`SELECT started_at, cost_usd, status, tokens_in + tokens_out t FROM runs WHERE started_at >= ?`).all(start) as { started_at: number; cost_usd: number; status: string; t: number }[];
  const out = Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return { day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), ts: d.getTime(), cost: 0, runs: 0, failed: 0, tokens: 0 };
  });
  for (const r of rows) {
    const idx = out.findLastIndex((p) => p.ts <= r.started_at);
    if (idx < 0) continue;
    out[idx].cost += r.cost_usd;
    out[idx].runs++;
    if (r.status === "failed") out[idx].failed++;
    out[idx].tokens += r.t;
  }
  return out.map((p) => ({ ...p, cost: Math.round(p.cost * 100) / 100 }));
}

export function topRuns(db: DB, sinceMs: number, limit = 10, now = Date.now()): RunView[] {
  return (db.$client.prepare(`SELECT * FROM runs WHERE started_at >= ? AND cost_usd > 0 ORDER BY cost_usd DESC LIMIT ?`).all(sinceMs, limit) as RunRow[]).map((r) => toRun(r, now));
}
