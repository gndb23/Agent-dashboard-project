import { z } from "zod";

/**
 * Event contract v1 — see docs/EVENT_SCHEMA.md.
 * RULE: this contract only ever gains optional fields. Never rename/remove.
 */
export const EVENT_TYPES = [
  "run_started",
  "tool_called",
  "tool_result",
  "message",
  "error",
  "run_completed",
  "heartbeat",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const timestamp = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const ms = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  if (!Number.isFinite(ms)) {
    ctx.addIssue({ code: "custom", message: "timestamp must be ISO-8601 or epoch (s or ms)" });
    return z.NEVER;
  }
  return Math.round(ms);
});

export const metricsSchema = z
  .object({
    tokens_in: z.number().nonnegative().optional(),
    tokens_out: z.number().nonnegative().optional(),
    cost_usd: z.number().nonnegative().optional(),
    duration_ms: z.number().nonnegative().optional(),
  })
  .loose();

const idString = z.string().min(1).max(200);

export const agentEventSchema = z
  .object({
    schema_version: z.literal(1),
    agent_id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "agent_id must be a lowercase slug").max(100),
    run_id: idString,
    session_id: idString.optional(),
    event_type: z.enum(EVENT_TYPES),
    timestamp: timestamp.optional(),
    status: z.string().max(40).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    metrics: metricsSchema.optional(),
    // --- optional additions (still v1) ---
    /** Client-generated id for idempotent retries/backfills. */
    event_id: idString.optional(),
    /** When true, metrics are run-to-date totals (max-merged) rather than deltas (summed). */
    metrics_cumulative: z.boolean().optional(),
    /** Run that triggered this run (agent-to-agent handoff). Drawn as a detected link on /workflow. */
    parent_run_id: idString.optional(),
    /** Agent that owns parent_run_id. Optional when the parent run is already known to the dashboard. */
    parent_agent_id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(100).optional(),
    /** Who emitted the event, e.g. "claude-code-hook", "transcript-import", "sdk". */
    source: z.string().max(60).optional(),
  })
  .loose();

export type AgentEventInput = z.input<typeof agentEventSchema>;
export type AgentEvent = z.output<typeof agentEventSchema>;
