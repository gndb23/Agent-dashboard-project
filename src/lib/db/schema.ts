/**
 * Database schema: plain SQL (applied idempotently on startup) plus matching TypeScript row types.
 * Add new columns through COLUMN_MIGRATIONS; never edit existing columns.
 */

export const RUN_STATUSES = ["running", "success", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ALERT_STATUSES = ["open", "acknowledged", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** One execution of an agent. For Claude Code, one run == one session. */
export type Run = {
  id: string;
  agentId: string;
  sessionId: string | null;
  status: RunStatus;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  lastEventAt: number;
  durationMs: number | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  eventCount: number;
  toolCount: number;
  errorCount: number;
  parentRunId: string | null;
  parentAgentId: string | null;
};

/** Raw event log row (append-only). */
export type EventRow = {
  id: number;
  eventId: string | null;
  agentId: string;
  runId: string;
  sessionId: string | null;
  eventType: string;
  timestamp: number;
  status: string | null;
  payload: Record<string, unknown> | null;
  metrics: Record<string, number> | null;
  receivedAt: number;
};

export type Alert = {
  id: number;
  agentId: string;
  ruleKey: string;
  ruleType: string;
  severity: "warning" | "critical";
  message: string;
  status: AlertStatus;
  runId: string | null;
  triggeredAt: number;
  acknowledgedAt: number | null;
  resolvedAt: number | null;
};

/** Dashboard ↔ agent chat transcript (one row per message). */
export type ChatMessage = {
  id: number;
  agentId: string;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  tools: string[] | null;
  sessionId: string | null;
  status: "done" | "streaming" | "error" | "stopped";
  costUsd: number | null;
  createdAt: number;
};

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

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  tools TEXT,
  session_id TEXT,
  status TEXT NOT NULL,
  cost_usd REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_agent_idx ON chat_messages(agent_id, id);
`;

/** Additive column migrations, applied once each (checked against PRAGMA table_info). */
export const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "runs", column: "parent_run_id", ddl: "ALTER TABLE runs ADD COLUMN parent_run_id TEXT" },
  { table: "runs", column: "parent_agent_id", ddl: "ALTER TABLE runs ADD COLUMN parent_agent_id TEXT" },
];
