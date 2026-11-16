import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 items-center gap-1 rounded-full border px-2 text-2xs font-medium leading-none whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "border-border bg-surface-2 text-fg-muted",
        outline: "border-border-strong bg-transparent text-fg-muted",
        success: "border-transparent bg-status-success/12 text-status-success-fg",
        running: "border-transparent bg-status-running/12 text-status-running-fg",
        warning: "border-transparent bg-status-warning/14 text-status-warning-fg",
        failed: "border-transparent bg-status-failed/12 text-status-failed-fg",
        idle: "border-transparent bg-status-idle/18 text-fg-muted",
        accent: "border-transparent bg-accent-soft text-accent",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
