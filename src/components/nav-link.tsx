"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, children, exact }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-8 items-center gap-2.5 rounded-control px-2.5 text-sm transition-colors",
        active ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
      )}
    >
      {active && <span className="absolute -left-2 top-1.5 h-5 w-[3px] rounded-r-full bg-accent" aria-hidden />}
      {children}
    </Link>
  );
}
