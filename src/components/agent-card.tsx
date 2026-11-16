import Link from "next/link";
import { Bell, CalendarClock } from "lucide-react";
import type { AgentCard as AgentCardData } from "@/lib/queries";
import { pct, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { StatusDot, STATUS_LABEL } from "./status";
import { RunStrip } from "./run-strip";
import { CreateManifestButton } from "./actions";

export function AgentCard({ card, now }: { card: AgentCardData; now: number }) {
  const unregistered = !card.manifest;
  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col rounded-card border bg-surface shadow-card transition-colors",
        unregistered ? "border-dashed border-border-strong" : "border-border hover:border-border-strong",
      )}
    >
      <Link href={`/agents/${encodeURIComponent(card.id)}`} className="absolute inset-0 z-0 rounded-card" aria-label={`Open ${card.name}`} />
      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={card.status} />
            <span
              className="truncate text-[14px] font-semibold tracking-tight text-fg"
              style={card.manifest?.color ? { textDecorationColor: card.manifest.color } : undefined}
            >
              {card.name}
            </span>
          </div>
          <div className="mt-1 truncate text-[12px] text-fg-subtle">
            {unregistered ? "Sending events without a manifest" : card.manifest?.description || card.id}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {card.openAlerts > 0 && (
            <Badge variant="failed">
              <Bell size={11} /> {card.openAlerts}
            </Badge>
          )}
          {unregistered ? <Badge variant="outline">Unregistered</Badge> : <Badge>{card.manifest?.type}</Badge>}
        </div>
      </div>

      <div className="pointer-events-none relative z-10 px-4 pt-3">
        <RunStrip runs={card.recentRuns} />
      </div>

      <dl className="pointer-events-none relative z-10 grid grid-cols-3 gap-2 px-4 py-3 text-[12px]">
        <div>
          <dt className="text-fg-subtle">Last run</dt>
          <dd className="mt-0.5 tabular text-fg">{timeAgo(card.lastRun?.startedAt, now)}</dd>
        </div>
        <div>
          <dt className="text-fg-subtle">Success 7d</dt>
          <dd className="mt-0.5 tabular text-fg">{pct(card.successRate7d)}</dd>
        </div>
        <div>
          <dt className="text-fg-subtle">Runs 24h</dt>
          <dd className="mt-0.5 tabular text-fg">{card.runs24h}</dd>
        </div>
      </dl>

      <div className="relative z-10 mt-auto flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-[12px] text-fg-subtle">
        <span className="pointer-events-none">{STATUS_LABEL[card.status]}</span>
        {unregistered ? (
          <CreateManifestButton agentId={card.id} type={card.lastSource === "claude-code-hook" || card.lastSource === "transcript-import" ? "claude-code" : "other"} />
        ) : card.nextRunAt ? (
          <span className="pointer-events-none inline-flex items-center gap-1 tabular">
            <CalendarClock size={12} /> next {timeAgo(card.nextRunAt, now)}
          </span>
        ) : (
          <span className="pointer-events-none">on demand</span>
        )}
      </div>
    </div>
  );
}
