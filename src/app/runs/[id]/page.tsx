import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { getChildRuns, getRun, type TimelineEvent } from "@/lib/queries";
import { CornerDownRight, CornerLeftUp } from "lucide-react";
import { getRegistry } from "@/lib/registry/registry";
import { clockTime, compact, dateTime, duration, usd } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Kpi } from "@/components/kpi";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RunStatusBadge } from "@/components/status";
import { cn } from "@/lib/utils";
import { AskAboutButton } from "@/components/assistant";
import { RunAgentButton } from "@/components/agent-actions";
import { Markdown } from "@/components/markdown";

function tone(e: TimelineEvent) {
  if (e.eventType === "error" || e.status === "error" || e.status === "failed") return "failed";
  if (e.eventType === "run_started") return "running";
  if (e.eventType === "run_completed") return "success";
  return "idle";
}
const DOT = { failed: "bg-status-failed", running: "bg-status-running", success: "bg-status-success", idle: "bg-border-strong" } as const;
const LABEL: Record<string, string> = {
  run_started: "started", tool_called: "tool", tool_result: "result", message: "message", error: "error", run_completed: "completed", heartbeat: "heartbeat",
};

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const now = Date.now();
  const data = getRun(getDb(), decodeURIComponent(id), now);
  if (!data) notFound();
  const { run, events } = data;
  const agent = getRegistry().byId.get(run.agentId);
  const t0 = run.startedAt;
  const registry = getRegistry();
  const children = getChildRuns(getDb(), run.id, now);
  const agentName = (aid: string | null) => (aid ? (registry.byId.get(aid)?.name ?? aid) : "another agent");

  return (
    <>
      <PageHeader
        eyebrow={
          <span>
            <Link href="/runs" className="hover:text-fg">Runs</Link> /{" "}
            <Link href={`/agents/${encodeURIComponent(run.agentId)}`} className="hover:text-fg">{agent?.name ?? run.agentId}</Link>
          </span>
        }
        title={run.title ?? "Run"}
        description={<span className="font-mono text-xs">{run.id}</span>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={run.status} stalled={run.stalled} />
            <AskAboutButton
              question={`Look at run ${run.id} of the agent "${agent?.name ?? run.agentId}". What did it do${run.status === "failed" || run.errorCount ? ", what went wrong, and how do I fix it" : ""}?`}
              label={run.status === "failed" || run.errorCount ? "Why did this fail?" : "Explain this run"}
            />
            {agent?.type === "claude-code" && <RunAgentButton agentId={run.agentId} compact />}
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Started" value={clockTime(run.startedAt)} hint={dateTime(run.startedAt)} />
        <Kpi label="Duration" value={duration(run.durationMs ?? now - run.startedAt)} hint={run.status === "running" ? "still running" : run.endedAt ? `ended ${clockTime(run.endedAt)}` : undefined} />
        <Kpi label="Events" value={run.eventCount} hint={`${run.toolCount} tool calls`} />
        <Kpi label="Errors" value={run.errorCount} tone={run.errorCount ? "failed" : undefined} />
        <Kpi label="Tokens" value={compact(run.tokensIn + run.tokensOut)} hint={`${compact(run.tokensIn)} in · ${compact(run.tokensOut)} out`} />
        <Kpi label="Est. cost" value={usd(run.costUsd)} />
      </section>

      {(() => {
        const done = [...events].reverse().find((e) => e.eventType === "run_completed" && typeof e.payload?.summary === "string" && (e.payload.summary as string).trim());
        return done ? (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>What it reported</CardTitle>
            </CardHeader>
            <div className="max-h-96 overflow-y-auto px-5 py-4">
              <Markdown text={String(done.payload!.summary)} />
            </div>
          </Card>
        ) : null;
      })()}

      {(run.parentRunId || children.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          {run.parentRunId && (
            <Link href={`/runs/${encodeURIComponent(run.parentRunId)}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-fg-muted hover:border-accent hover:text-fg">
              <CornerLeftUp size={13} /> Triggered by <span className="font-medium text-fg">{agentName(run.parentAgentId)}</span>
            </Link>
          )}
          {children.map((c) => (
            <Link key={c.id} href={`/runs/${encodeURIComponent(c.id)}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-fg-muted hover:border-accent hover:text-fg">
              <CornerDownRight size={13} /> Triggered <span className="font-medium text-fg">{agentName(c.agentId)}</span>
              <RunStatusBadge status={c.status} stalled={c.stalled} />
            </Link>
          ))}
        </div>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <span className="text-xs text-fg-subtle">{events.length} events · click to expand</span>
        </CardHeader>
        <ol className="relative py-2">
          {events.map((e) => {
            const t = tone(e);
            return (
              <li key={e.id} className="relative pl-12 pr-4">
                <span className="absolute left-[23px] top-0 h-full w-px bg-border" aria-hidden />
                <span className={cn("absolute left-[19px] top-[13px] h-[9px] w-[9px] rounded-full ring-4 ring-surface", DOT[t])} aria-hidden />
                <details className="group rounded-control">
                  <summary className="flex cursor-pointer list-none items-center gap-3 rounded-control px-2 py-1.5 hover:bg-surface-hover">
                    <span className="w-16 shrink-0 font-mono text-2xs text-fg-subtle tabular">+{duration(e.timestamp - t0)}</span>
                    <Badge variant={t === "failed" ? "failed" : t === "success" ? "success" : t === "running" ? "running" : "neutral"} className="w-[72px] justify-center">
                      {LABEL[e.eventType] ?? e.eventType}
                    </Badge>
                    <span className={cn("min-w-0 flex-1 truncate text-sm", t === "failed" ? "text-status-failed-fg" : "text-fg")}>{e.summary}</span>
                    <span className="hidden shrink-0 font-mono text-2xs text-fg-subtle sm:inline">{clockTime(e.timestamp)}</span>
                  </summary>
                  <pre className="mb-2 ml-2 mt-1 max-h-96 overflow-auto rounded-control border border-border bg-surface-2 p-3 font-mono text-2xs leading-relaxed text-fg-muted">
                    {JSON.stringify({ event_type: e.eventType, status: e.status, timestamp: new Date(e.timestamp).toISOString(), payload: e.payload, metrics: e.metrics }, null, 2)}
                  </pre>
                </details>
              </li>
            );
          })}
        </ol>
      </Card>
    </>
  );
}
