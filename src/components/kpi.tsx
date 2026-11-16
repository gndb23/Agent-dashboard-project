import { cn } from "@/lib/utils";

type Tone = "failed" | "warning" | "running" | "success";
const VALUE: Record<Tone, string> = {
  failed: "text-status-failed-fg",
  warning: "text-status-warning-fg",
  running: "text-status-running-fg",
  success: "text-fg",
};
const RAIL: Record<Tone, string> = {
  failed: "bg-status-failed",
  warning: "bg-status-warning",
  running: "bg-status-running",
  success: "bg-status-success",
};

/** Headline stat tile. `tone` colors the value and adds a thin status rail. */
export function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone }) {
  return (
    <div className="relative overflow-hidden rounded-card border border-border bg-surface px-5 py-4 shadow-card">
      {tone && <span className={cn("absolute inset-y-0 left-0 w-[3px]", RAIL[tone])} aria-hidden />}
      <div className="eyebrow">{label}</div>
      <div className={cn("tabular mt-2 text-2xl font-semibold tracking-[-0.02em] text-fg", tone && VALUE[tone])}>{value}</div>
      {hint && <div className="mt-1 truncate text-xs text-fg-subtle">{hint}</div>}
    </div>
  );
}
