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
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
        active ? "bg-surface-hover font-medium text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}
