import { z } from "zod";
import type { DB } from "../db/client";
import { agentEventSchema, type AgentEvent } from "./schema";
import type { RunStatus } from "../db/schema";

export const MAX_PAYLOAD_BYTES = 32 * 1024;
export const MAX_BATCH = 1000;

export type IngestResult = {
  accepted: number;
  duplicates: number;
  rejected: { index: number; error: string }[];
  touched: { agentId: string; runId: string; eventType: string; timestamp: number }[];
};

const FINAL_STATUSES: Record<string, RunStatus> = {
  success: "success",
  succeeded: "success",
  ok: "success",
  completed: "success",
  failed: "failed",
  failure: "failed",
  error: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
  aborted: "cancelled",
};

function truncatePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!payload) return null;
  const json = JSON.stringify(payload);
  if (json.length <= MAX_PAYLOAD_BYTES) return payload;
  return { _truncated: true, _original_bytes: json.length, preview: json.slice(0, MAX_PAYLOAD_BYTES - 200) };
}

function titleFrom(e: AgentEvent): string | null {
  if (e.event_type !== "message" && e.event_type !== "run_started") return null;
  const p = e.payload ?? {};
  const cand = p.title ?? p.prompt ?? p.text ?? p.message;
  if (typeof cand !== "string" || !cand.trim()) return null;
  const clean = cand.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? clean.slice(0, 137) + "…" : clean;
}

function isErrorEvent(e: AgentEvent): boolean {
  if (e.event_type === "error") return true;
  const s = e.status?.toLowerCase();
  return s === "error" || s === "failed" || s === "failure";
}

/**
 * Validates and stores events, maintaining per-run aggregates.
 * Accepts a single event or an array. Idempotent when events carry `event_id`.
 */
export function ingestEvents(db: DB, input: unknown, now = Date.now()): IngestResult {
  const items = Array.isArray(input) ? input : [input];
  const result: IngestResult = { accepted: 0, duplicates: 0, rejected: [], touched: [] };
  if (items.length > MAX_BATCH) {
    result.rejected.push({ index: -1, error: `Batch too large (max ${MAX_BATCH})` });
    return result;
  }

  const sqlite = db.$client;
  const insertEvent = sqlite.prepare(
    `INSERT OR IGNORE INTO events (event_id, agent_id, run_id, session_id, event_type, timestamp, status, payload, metrics, received_at)
     VALUES (@event_id, @agent_id, @run_id, @session_id, @event_type, @timestamp, @status, @payload, @metrics, @received_at)`,
  );
  const getRun = sqlite.prepare(`SELECT * FROM runs WHERE id = ?`);
  const insertRun = sqlite.prepare(
    `INSERT INTO runs (id, agent_id, session_id, status, title, started_at, last_event_at)
     VALUES (@id, @agent_id, @session_id, 'running', @title, @started_at, @started_at)`,
  );
  const updateRun = sqlite.prepare(
    `UPDATE runs SET status=@status, title=@title, started_at=@started_at, ended_at=@ended_at, last_event_at=@last_event_at,
       duration_ms=@duration_ms, tokens_in=@tokens_in, tokens_out=@tokens_out, cost_usd=@cost_usd,
       event_count=@event_count, tool_count=@tool_count, error_count=@error_count, session_id=COALESCE(session_id, @session_id)
     WHERE id=@id`,
  );

  const tx = sqlite.transaction((list: unknown[]) => {
    list.forEach((raw, index) => {
      const parsed = agentEventSchema.safeParse(raw);
      if (!parsed.success) {
        result.rejected.push({ index, error: z.prettifyError(parsed.error) });
        return;
      }
      const e = parsed.data;
      const ts = e.timestamp ?? now;

      const ins = insertEvent.run({
        event_id: e.event_id ?? null,
        agent_id: e.agent_id,
        run_id: e.run_id,
        session_id: e.session_id ?? null,
        event_type: e.event_type,
        timestamp: ts,
        status: e.status ?? null,
        payload: JSON.stringify(truncatePayload({ ...(e.payload ?? {}), ...(e.source ? { _source: e.source } : {}) })),
        metrics: e.metrics ? JSON.stringify(e.metrics) : null,
        received_at: now,
      });
      if (ins.changes === 0) {
        result.duplicates++;
        return;
      }

      type RunRow = {
        id: string; agent_id: string; status: RunStatus; title: string | null; started_at: number;
        ended_at: number | null; last_event_at: number; duration_ms: number | null; tokens_in: number;
        tokens_out: number; cost_usd: number; event_count: number; tool_count: number; error_count: number;
      };
      let run = getRun.get(e.run_id) as RunRow | undefined;
      if (!run) {
        insertRun.run({ id: e.run_id, agent_id: e.agent_id, session_id: e.session_id ?? null, title: titleFrom(e), started_at: ts });
        run = getRun.get(e.run_id) as RunRow;
      } else if (run.agent_id !== e.agent_id) {
        result.rejected.push({ index, error: `run_id "${e.run_id}" already belongs to agent "${run.agent_id}"` });
        // keep the event row (already inserted) out of aggregates; remove it to keep data consistent
        sqlite.prepare(`DELETE FROM events WHERE id = ?`).run(ins.lastInsertRowid);
        return;
      }

      const next = { ...run, session_id: e.session_id ?? null };
      next.event_count += 1;
      next.started_at = Math.min(run.started_at, ts);
      next.last_event_at = Math.max(run.last_event_at, ts);
      if (!next.title) next.title = titleFrom(e);
      if (e.event_type === "tool_called") next.tool_count += 1;
      if (isErrorEvent(e)) next.error_count += 1;

      const m = e.metrics;
      if (m) {
        if (e.metrics_cumulative) {
          next.tokens_in = Math.max(next.tokens_in, m.tokens_in ?? 0);
          next.tokens_out = Math.max(next.tokens_out, m.tokens_out ?? 0);
          next.cost_usd = Math.max(next.cost_usd, m.cost_usd ?? 0);
        } else {
          next.tokens_in += m.tokens_in ?? 0;
          next.tokens_out += m.tokens_out ?? 0;
          next.cost_usd += m.cost_usd ?? 0;
        }
      }

      if (e.event_type === "run_completed") {
        const final = FINAL_STATUSES[e.status?.toLowerCase() ?? ""] ?? "success";
        next.status = final;
        next.ended_at = Math.max(ts, run.ended_at ?? 0);
        next.duration_ms = m?.duration_ms ?? next.ended_at - next.started_at;
      } else if (e.event_type !== "heartbeat" && run.status !== "running" && ts > (run.ended_at ?? 0)) {
        // Activity after completion (e.g. a new turn in the same Claude Code session) re-opens the run.
        next.status = "running";
        next.ended_at = null;
        next.duration_ms = null;
      }

      updateRun.run(next);
      result.accepted++;
      result.touched.push({ agentId: e.agent_id, runId: e.run_id, eventType: e.event_type, timestamp: ts });
    });
  });
  tx(items);
  return result;
}
