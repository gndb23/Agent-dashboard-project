import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-control text-sm font-medium transition-[background-color,border-color,color,opacity,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg font-semibold hover:opacity-90",
        secondary: "border border-border-strong bg-surface text-fg hover:bg-surface-hover",
        ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
      },
      size: { sm: "h-7 px-2.5 text-xs", md: "h-8 px-3", icon: "h-8 w-8" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export function Button({ className, variant, size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
