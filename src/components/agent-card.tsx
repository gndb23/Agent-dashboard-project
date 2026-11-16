import Link from "next/link";
import { Bell, CalendarClock, MousePointerClick } from "lucide-react";
import type { AgentCard as AgentCardData } from "@/lib/queries";
import { pct, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { StatusDot, STATUS_LABEL } from "./status";
import { RunStrip } from "./run-strip";
import { CreateManifestButton } from "./actions";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-2xs text-fg-subtle">{label}</dt>
      <dd className="tabular mt-0.5 text-sm font-medium text-fg">{children}</dd>
    </div>
  );
}

export function AgentCard({ card, now }: { card: AgentCardData; now: number }) {
  const unregistered = !card.manifest;
  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col rounded-card border bg-surface shadow-card transition-[border-color,transform] duration-150",
        unregistered ? "border-dashed border-border-strong" : "border-border hover:border-border-strong",
      )}
    >
      <Link href={`/agents/${encodeURIComponent(card.id)}`} className="absolute inset-0 z-0 rounded-card" aria-label={`Open ${card.name}`} />
      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={card.status} />
            <span className="truncate text-base font-semibold tracking-[-0.01em] text-fg">{card.name}</span>
          </div>
          <div className="mt-1 truncate text-xs text-fg-subtle">
            {unregistered ? "Sending events without a manifest" : card.manifest?.description || card.id}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {card.openAlerts > 0 && (
            <Badge variant="failed">
              <Bell size={10} /> {card.openAlerts}
            </Badge>
          )}
          {unregistered ? <Badge variant="outline">Unregistered</Badge> : <Badge>{card.manifest?.type}</Badge>}
        </div>
      </div>

      <div className="pointer-events-none relative z-10 px-5 pt-4">
        <RunStrip runs={card.recentRuns} />
      </div>

      <dl className="pointer-events-none relative z-10 grid grid-cols-3 gap-3 px-5 py-4">
        <Stat label="Last run">{timeAgo(card.lastRun?.startedAt, now)}</Stat>
        <Stat label="Success 7d">{pct(card.successRate7d)}</Stat>
        <Stat label="Runs 24h">{card.runs24h}</Stat>
      </dl>

      <div className="relative z-10 mt-auto flex min-h-11 items-center justify-between gap-2 border-t border-border px-5 py-2 text-xs text-fg-subtle">
        <span
          className={cn(
            "pointer-events-none font-medium",
            card.status === "failed" && "text-status-failed-fg",
            card.status === "warning" && "text-status-warning-fg",
            card.status === "running" && "text-status-running-fg",
            card.status === "success" && "text-fg-muted",
          )}
        >
          {STATUS_LABEL[card.status]}
        </span>
        {unregistered ? (
          <CreateManifestButton agentId={card.id} type={card.lastSource === "claude-code-hook" || card.lastSource === "transcript-import" ? "claude-code" : "other"} />
        ) : card.nextRunAt ? (
          <span className="tabular pointer-events-none inline-flex items-center gap-1.5">
            <CalendarClock size={12} /> next {timeAgo(card.nextRunAt, now)}
          </span>
        ) : (
          <span className="pointer-events-none inline-flex items-center gap-1.5">
            <MousePointerClick size={12} /> on demand
          </span>
        )}
      </div>
    </div>
  );
}
