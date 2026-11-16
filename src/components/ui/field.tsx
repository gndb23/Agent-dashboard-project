import { cn } from "@/lib/utils";

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="text-sm font-medium text-fg">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-fg-subtle">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

export const inputCls =
  "w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent disabled:opacity-60";
