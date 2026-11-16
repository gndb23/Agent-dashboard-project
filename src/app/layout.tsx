import type { Metadata } from "next";
import Link from "next/link";
import { Activity } from "lucide-react";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { LiveIndicator, LiveProvider } from "@/components/live-provider";
import { ThemeToggle, themeInitScript } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Agent Ops",
  description: "Monitor every agent workflow in one place.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen">
        <LiveProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur md:px-8">
                <Link href="/" className="flex items-center gap-2 md:hidden">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-fg">
                    <Activity size={14} strokeWidth={2.5} />
                  </span>
                  <span className="text-[14px] font-semibold">Agent Ops</span>
                </Link>
                <div className="hidden text-[12px] text-fg-subtle md:block">Local · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
                <div className="flex items-center gap-1.5">
                  <LiveIndicator />
                  <ThemeToggle />
                </div>
              </header>
              <nav className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2 text-[13px] md:hidden">
                <Link href="/" className="rounded-md px-2 py-1 text-fg-muted hover:bg-surface-hover hover:text-fg">Overview</Link>
                <Link href="/alerts" className="rounded-md px-2 py-1 text-fg-muted hover:bg-surface-hover hover:text-fg">Alerts</Link>
                <Link href="/onboarding" className="whitespace-nowrap rounded-md px-2 py-1 text-fg-muted hover:bg-surface-hover hover:text-fg">Add an agent</Link>
              </nav>
              <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-4 py-6 md:px-8">{children}</main>
            </div>
          </div>
        </LiveProvider>
      </body>
    </html>
  );
}
