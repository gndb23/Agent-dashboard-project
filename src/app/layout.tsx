import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Logo, Sidebar } from "@/components/sidebar";
import { LiveIndicator, LiveProvider } from "@/components/live-provider";
import { ThemeToggle, themeInitScript } from "@/components/theme-toggle";
import { AssistantProvider, AskButton, OpenAskButton } from "@/components/assistant";
import { Toaster } from "@/components/toaster";
import { getRegistry } from "@/lib/registry/registry";
import { getAgentCards } from "@/lib/queries";
import { getDb } from "@/lib/db/client";
import { hasDemoData } from "@/lib/demo";

export const metadata: Metadata = {
  title: { default: "Agent Ops", template: "%s · Agent Ops" },
  description: "Monitor, run and talk to every agent in one place.",
};

export const dynamic = "force-dynamic";

const mobileLink = "whitespace-nowrap rounded-control px-2.5 py-1 text-fg-muted hover:bg-surface-hover hover:text-fg";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const db = getDb();
  const agents = getAgentCards(db, getRegistry(), Date.now()).map((c) => ({ id: c.id, name: c.name, status: c.status }));
  const demo = hasDemoData(db);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body className="min-h-screen">
        <LiveProvider>
          <AssistantProvider agents={agents}>
            <div className="flex min-h-screen">
              <Sidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-md md:px-10">
                  <Link href="/" className="md:hidden">
                    <Logo />
                  </Link>
                  <AskButton className="hidden w-full max-w-sm md:flex" />
                  <div className="flex items-center gap-1.5">
                    <AskButton className="md:hidden" />
                    <OpenAskButton />
                    <LiveIndicator />
                    <ThemeToggle />
                  </div>
                </header>
                <nav className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2 text-sm md:hidden">
                  <Link href="/" className={mobileLink}>Overview</Link>
                  <Link href="/agents" className={mobileLink}>Agents</Link>
                  <Link href="/agents/new" className={mobileLink}>New agent</Link>
                  <Link href="/runs" className={mobileLink}>Runs</Link>
                  <Link href="/workflow" className={mobileLink}>Workflow</Link>
                  <Link href="/usage" className={mobileLink}>Usage</Link>
                  <Link href="/alerts" className={mobileLink}>Alerts</Link>
                  <Link href="/settings" className={mobileLink}>Settings</Link>
                </nav>
                {demo && (
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-status-warning/30 bg-status-warning/10 px-4 py-2 text-center text-xs text-status-warning-fg">
                    <span>
                      <strong>Demo data is showing</strong> alongside your real agents.
                    </span>
                    <Link href="/settings#demo" className="underline underline-offset-2 hover:opacity-80">Remove it</Link>
                  </div>
                )}
                <main className="mx-auto w-full min-w-0 max-w-[1440px] flex-1 px-4 py-8 md:px-10">{children}</main>
              </div>
            </div>
          </AssistantProvider>
        </LiveProvider>
        <Toaster />
      </body>
    </html>
  );
}
