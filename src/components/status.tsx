import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import type { DisplayStatus } from "@/lib/queries";

const DOT: Record<DisplayStatus, string> = {
  success: "bg-status-success",
  running: "bg-status-running animate-pulse-dot",
  warning: "bg-status-warning",
  failed: "bg-status-failed",
  idle: "bg-status-idle",
};

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  success: "Healthy",
  running: "Running",
  warning: "Attention",
  failed: "Failing",
  idle: "Idle",
};

export function StatusDot({ status, className }: { status: DisplayStatus; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[status], className)} aria-hidden />;
}

/** Badge for a run's raw status (+ stalled). */
export function RunStatusBadge({ status, stalled }: { status: string; stalled?: boolean }) {
  if (stalled) return <Badge variant="warning">stalled</Badge>;
  const variant = status === "success" ? "success" : status === "failed" ? "failed" : status === "running" ? "running" : "idle";
  return (
    <Badge variant={variant}>
      {status === "running" && <span className="h-1.5 w-1.5 rounded-full bg-status-running animate-pulse-dot" />}
      {status}
    </Badge>
  );
}
