import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Logo, Sidebar } from "@/components/sidebar";
import { LiveIndicator, LiveProvider } from "@/components/live-provider";
import { ThemeToggle, themeInitScript } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: { default: "Agent Ops", template: "%s · Agent Ops" },
  description: "Monitor every agent workflow in one place.",
};

export const dynamic = "force-dynamic";

const mobileLink = "whitespace-nowrap rounded-control px-2.5 py-1 text-fg-muted hover:bg-surface-hover hover:text-fg";

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
              <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-md md:px-10">
                <Link href="/" className="md:hidden">
                  <Logo />
                </Link>
                <div className="hidden text-xs text-fg-subtle md:block">
                  {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </div>
                <div className="flex items-center gap-1.5">
                  <LiveIndicator />
                  <ThemeToggle />
                </div>
              </header>
              <nav className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2 text-sm md:hidden">
                <Link href="/" className={mobileLink}>Overview</Link>
                <Link href="/workflow" className={mobileLink}>Workflow</Link>
                <Link href="/alerts" className={mobileLink}>Alerts</Link>
                <Link href="/onboarding" className={mobileLink}>Add an agent</Link>
              </nav>
              <main className="mx-auto w-full min-w-0 max-w-[1440px] flex-1 px-4 py-8 md:px-10">{children}</main>
            </div>
          </div>
        </LiveProvider>
      </body>
    </html>
  );
}
