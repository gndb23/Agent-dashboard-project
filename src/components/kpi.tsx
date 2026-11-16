import { cn } from "@/lib/utils";

export function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "failed" | "warning" | "running" | "success" }) {
  return (
    <div className="rounded-card border border-border bg-surface px-4 py-3 shadow-card">
      <div className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{label}</div>
      <div
        className={cn(
          "mt-1.5 text-2xl font-semibold tracking-tight tabular text-fg",
          tone === "failed" && "text-status-failed",
          tone === "warning" && "text-status-warning",
          tone === "running" && "text-status-running",
          tone === "success" && "text-status-success",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-fg-subtle">{hint}</div>}
    </div>
  );
}
