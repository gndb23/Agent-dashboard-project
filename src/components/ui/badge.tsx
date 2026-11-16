import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "border-border bg-surface-2 text-fg-muted",
        outline: "border-border-strong bg-transparent text-fg-muted",
        success: "border-transparent bg-status-success/12 text-status-success",
        running: "border-transparent bg-status-running/12 text-status-running",
        warning: "border-transparent bg-status-warning/14 text-status-warning",
        failed: "border-transparent bg-status-failed/12 text-status-failed",
        idle: "border-transparent bg-status-idle/14 text-fg-muted",
        accent: "border-transparent bg-accent/14 text-accent",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
