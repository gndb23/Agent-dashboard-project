import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const RUN_STATUSES = ["running", "success", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ALERT_STATUSES = ["open", "acknowledged", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** One execution of an agent. For Claude Code, one run == one session. */
export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    sessionId: text("session_id"),
    status: text("status", { enum: RUN_STATUSES }).notNull(),
    title: text("title"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    lastEventAt: integer("last_event_at").notNull(),
    durationMs: integer("duration_ms"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    eventCount: integer("event_count").notNull().default(0),
    toolCount: integer("tool_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
  },
  (t) => [
    index("runs_agent_started_idx").on(t.agentId, t.startedAt),
    index("runs_started_idx").on(t.startedAt),
  ],
);

/** Raw event log, append-only. */
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: text("event_id"),
    agentId: text("agent_id").notNull(),
    runId: text("run_id").notNull(),
    sessionId: text("session_id"),
    eventType: text("event_type").notNull(),
    timestamp: integer("timestamp").notNull(),
    status: text("status"),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    metrics: text("metrics", { mode: "json" }).$type<Record<string, number>>(),
    receivedAt: integer("received_at").notNull(),
  },
  (t) => [
    uniqueIndex("events_event_id_uq").on(t.eventId),
    index("events_run_ts_idx").on(t.runId, t.timestamp),
    index("events_ts_idx").on(t.timestamp),
  ],
);

export const alerts = sqliteTable(
  "alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agentId: text("agent_id").notNull(),
    ruleKey: text("rule_key").notNull(),
    ruleType: text("rule_type").notNull(),
    severity: text("severity", { enum: ["warning", "critical"] }).notNull(),
    message: text("message").notNull(),
    status: text("status", { enum: ALERT_STATUSES }).notNull(),
    runId: text("run_id"),
    triggeredAt: integer("triggered_at").notNull(),
    acknowledgedAt: integer("acknowledged_at"),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [index("alerts_status_idx").on(t.status, t.triggeredAt), index("alerts_agent_idx").on(t.agentId, t.ruleKey)],
);

export type Run = typeof runs.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type Alert = typeof alerts.$inferSelect;

/**
 * DDL kept next to the Drizzle schema. Applied idempotently on startup —
 * add new columns with ALTER TABLE in MIGRATIONS below, never edit existing ones.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL,
  title TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  last_event_at INTEGER NOT NULL,
  duration_ms INTEGER,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  tool_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS runs_agent_started_idx ON runs(agent_id, started_at);
CREATE INDEX IF NOT EXISTS runs_started_idx ON runs(started_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  agent_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  status TEXT,
  payload TEXT,
  metrics TEXT,
  received_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS events_event_id_uq ON events(event_id);
CREATE INDEX IF NOT EXISTS events_run_ts_idx ON events(run_id, timestamp);
CREATE INDEX IF NOT EXISTS events_ts_idx ON events(timestamp);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL,
  run_id TEXT,
  triggered_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS alerts_status_idx ON alerts(status, triggered_at);
CREATE INDEX IF NOT EXISTS alerts_agent_idx ON alerts(agent_id, rule_key);
`;
