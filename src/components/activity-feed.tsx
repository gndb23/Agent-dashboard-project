import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDot, MessageSquare, Play, Wrench } from "lucide-react";
import type { ActivityItem } from "@/lib/queries";
import { clockTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

function Icon({ item }: { item: ActivityItem }) {
  const err = item.eventType === "error" || item.status === "error" || item.status === "failed";
  const cls = "shrink-0 mt-0.5";
  if (err) return <AlertTriangle size={14} className={cn(cls, "text-status-failed")} />;
  switch (item.eventType) {
    case "run_started":
      return <Play size={14} className={cn(cls, "text-status-running")} />;
    case "run_completed":
      return <CheckCircle2 size={14} className={cn(cls, "text-status-success")} />;
    case "tool_called":
    case "tool_result":
      return <Wrench size={14} className={cn(cls, "text-fg-subtle")} />;
    case "message":
      return <MessageSquare size={14} className={cn(cls, "text-fg-subtle")} />;
    default:
      return <CircleDot size={14} className={cn(cls, "text-fg-subtle")} />;
  }
}

export function ActivityFeed({ items, showAgent = true, now }: { items: ActivityItem[]; showAgent?: boolean; now: number }) {
  if (items.length === 0) {
    return <div className="px-4 py-10 text-center text-[13px] text-fg-subtle">No activity yet. Events appear here the moment an agent reports in.</div>;
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((it) => (
        <li key={it.id}>
          <Link href={`/runs/${encodeURIComponent(it.runId)}`} className="flex gap-2.5 px-4 py-2 hover:bg-surface-hover">
            <Icon item={it} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-fg">{it.summary}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-subtle">
                {showAgent && <span className="font-medium text-fg-muted">{it.agentId}</span>}
                {showAgent && <span>·</span>}
                <span className="tabular" title={new Date(it.timestamp).toISOString()}>
                  {now - it.timestamp < 3_600_000 ? clockTime(it.timestamp) : timeAgo(it.timestamp, now)}
                </span>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
