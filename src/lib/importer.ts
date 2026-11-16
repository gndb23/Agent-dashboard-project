import path from "node:path";
import type { AgentEventInput } from "./events/schema";
import { estimateCost, totalInputTokens, type Usage } from "./pricing";

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[^a-z0-9]+/, "")
      .replace(/-+$/, "")
      .slice(0, 100) || "unknown"
  );
}

type Block = { type: string; [k: string]: unknown };
type Line = {
  type?: string;
  uuid?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: { id?: string; role?: string; model?: string; content?: string | Block[]; usage?: Usage };
};

const clip = (s: string, n = 2000) => (s.length > n ? s.slice(0, n) + "…" : s);

function summaryOf(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  const v = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt;
  return typeof v === "string" ? v.replace(/\s+/g, " ").slice(0, 200) : undefined;
}

/**
 * Converts one Claude Code transcript (JSONL text) into Agent Ops events.
 * Every event has a deterministic event_id, so re-importing is a no-op.
 */
export function transcriptToEvents(text: string, opts: { fileName: string; agentId?: string }): AgentEventInput[] {
  const lines: Line[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      /* skip corrupt line */
    }
  }
  const dated = lines.filter((l) => l.timestamp && !Number.isNaN(Date.parse(l.timestamp)));
  if (dated.length === 0) return [];

  const sessionId = dated.find((l) => l.sessionId)?.sessionId ?? path.basename(opts.fileName, ".jsonl");
  const cwd = dated.find((l) => l.cwd)?.cwd;
  const agentId = opts.agentId ?? slug(cwd ? path.basename(cwd) : "claude-code");
  const base = { schema_version: 1 as const, agent_id: agentId, run_id: sessionId, session_id: sessionId, source: "transcript-import" };
  const toolNames = new Map<string, string>();
  const out: AgentEventInput[] = [];
  const seenUsage = new Set<string>();
  let tokensIn = 0, tokensOut = 0, cost = 0;

  out.push({ ...base, event_type: "run_started", timestamp: dated[0].timestamp, event_id: `${sessionId}:start`, payload: { cwd, imported: true } });

  for (const l of dated) {
    const msg = l.message;
    if (!msg) continue;
    const id = l.uuid ?? `${l.timestamp}`;
    const content = msg.content;
    if (l.type === "assistant") {
      const usageKey = msg.id ?? id;
      if (msg.usage && !seenUsage.has(usageKey)) {
        seenUsage.add(usageKey);
        tokensIn += totalInputTokens(msg.usage);
        tokensOut += msg.usage.output_tokens ?? 0;
        cost += estimateCost(msg.model, msg.usage);
      }
      if (Array.isArray(content)) {
        content.forEach((b, i) => {
          if (b.type !== "tool_use") return;
          const name = String(b.name ?? "tool");
          if (typeof b.id === "string") toolNames.set(b.id, name);
          out.push({
            ...base, event_type: "tool_called", timestamp: l.timestamp, event_id: `${sessionId}:${id}:${i}`,
            payload: { tool: name, summary: summaryOf(b.input), input: clip(JSON.stringify(b.input ?? {})), sidechain: l.isSidechain || undefined },
          });
        });
      }
    } else if (l.type === "user") {
      if (typeof content === "string") {
        if (l.isMeta || content.startsWith("<")) continue;
        out.push({ ...base, event_type: "message", timestamp: l.timestamp, event_id: `${sessionId}:${id}`, payload: { role: "user", text: clip(content) } });
      } else if (Array.isArray(content)) {
        content.forEach((b, i) => {
          if (b.type === "tool_result") {
            const tool = toolNames.get(String(b.tool_use_id)) ?? "tool";
            const body = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
            out.push({
              ...base, event_type: "tool_result", timestamp: l.timestamp, event_id: `${sessionId}:${id}:${i}`,
              status: b.is_error ? "error" : "ok", payload: { tool, output: clip(body) },
            });
          } else if (b.type === "text" && typeof b.text === "string" && !l.isMeta && !b.text.startsWith("<")) {
            out.push({ ...base, event_type: "message", timestamp: l.timestamp, event_id: `${sessionId}:${id}:${i}`, payload: { role: "user", text: clip(b.text) } });
          }
        });
      }
    }
  }

  out.push({
    ...base,
    event_type: "run_completed",
    status: "success",
    timestamp: dated[dated.length - 1].timestamp,
    event_id: `${sessionId}:end:${dated.length}`,
    payload: { reason: "imported" },
    metrics: { tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: Math.round(cost * 10000) / 10000 },
    metrics_cumulative: true,
  });
  return out;
}
