import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { getRegistry } from "@/lib/registry/registry";
import { getActivity, getAgentCards, getKpis } from "@/lib/queries";
import { compact, pct, timeAgo, usd } from "@/lib/format";
import { StatusDot } from "@/components/status";
import { CreateManifestButton } from "@/components/actions";
import { Kpi } from "@/components/kpi";
import { AgentCard } from "@/components/agent-card";
import { ActivityFeed } from "@/components/activity-feed";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, SectionTitle } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { AskAboutButton } from "@/components/assistant";

export default function OverviewPage() {
  const db = getDb();
  const registry = getRegistry();
  const now = Date.now();
  const kpis = getKpis(db, now);
  const cards = getAgentCards(db, registry, now);
  const activity = getActivity(db, { limit: 40 });

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${registry.agents.length} registered agent${registry.agents.length === 1 ? "" : "s"} · live`}
        actions={
          <div className="flex items-center gap-2">
            <AskAboutButton question="Give me a quick status report: what ran since yesterday, anything that failed or is late, and anything I should do." label="What's happening?" />
            <Link href="/agents/new" className={buttonVariants({ variant: "primary" })}>
              New agent
            </Link>
          </div>
        }
      />

      {registry.errors.length > 0 && (
        <div className="mb-5 rounded-card border border-status-warning/35 bg-status-warning/8 px-5 py-3.5 text-sm">
          <div className="flex items-center gap-2 font-medium text-status-warning-fg">
            <AlertTriangle size={14} /> {registry.errors.length} manifest{registry.errors.length > 1 ? "s" : ""} need attention
          </div>
          <ul className="mt-1.5 space-y-1 text-fg-muted">
            {registry.errors.map((e) => (
              <li key={e.file}>
                <code className="font-mono text-xs text-fg">agents/{e.file}</code> — {e.error.split("\n").slice(0, 2).join(" ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Active now" value={kpis.activeNow} tone={kpis.activeNow > 0 ? "running" : undefined} hint="runs in progress" />
        <Kpi label="Runs today" value={compact(kpis.runsToday)} hint="since midnight" />
        <Kpi
          label="Success rate"
          value={pct(kpis.successRate24h)}
          tone={kpis.successRate24h != null && kpis.successRate24h < 0.9 ? "warning" : undefined}
          hint={`${kpis.completed24h} completed · 24h`}
        />
        <Kpi label="Failures" value={kpis.failures24h} tone={kpis.failures24h > 0 ? "failed" : undefined} hint="last 24h" />
        <Kpi label="Est. cost" value={usd(kpis.cost24h)} hint="last 24h" />
        <Kpi label="Open alerts" value={kpis.openAlerts} tone={kpis.openAlerts > 0 ? "failed" : "success"} hint={<Link href="/alerts" className="hover:text-fg">view alerts →</Link>} />
      </section>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_384px]">
        <section className="min-w-0">
          <SectionTitle aside="each bar is a run · height shows duration">Agents</SectionTitle>
          {cards.filter((c) => c.manifest).length === 0 ? (
            <EmptyState title="Let's add your first agent">
              Scheduled tasks you create in the Claude app appear here automatically. Or{" "}
              <Link href="/agents/new" className="text-accent hover:underline">create an agent here</Link>, or press <kbd className="rounded border border-border px-1 text-xs">Ctrl K</kbd> and describe one.
            </EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {cards
                .filter((c) => c.manifest)
                .map((c) => (
                  <AgentCard key={c.id} card={c} now={now} />
                ))}
            </div>
          )}
          {cards.some((c) => !c.manifest) && (
            <div className="mt-8">
              <SectionTitle aside="Claude Code sessions in folders that aren't set up as agents">Other activity</SectionTitle>
              <div className="overflow-hidden rounded-card border border-dashed border-border-strong bg-surface/60">
                <ul className="divide-y divide-border">
                  {cards
                    .filter((c) => !c.manifest)
                    .map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                        <StatusDot status={c.status} />
                        <Link href={`/agents/${encodeURIComponent(c.id)}`} className="min-w-0 flex-1 truncate text-sm text-fg hover:text-accent">
                          {c.name}
                        </Link>
                        <span className="tabular text-xs text-fg-subtle">
                          {c.runs24h} run{c.runs24h === 1 ? "" : "s"} today · last {timeAgo(c.lastRun?.startedAt, now)}
                        </span>
                        <CreateManifestButton agentId={c.id} type={c.lastSource === "claude-code-hook" || c.lastSource === "transcript-import" ? "claude-code" : "other"} />
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          )}
        </section>

        <Card className="self-start xl:sticky xl:top-20">
          <CardHeader>
            <CardTitle>Live activity</CardTitle>
            <span className="text-xs text-fg-subtle">latest {activity.length}</span>
          </CardHeader>
          <div className="max-h-[calc(100vh-11rem)] overflow-y-auto">
            <ActivityFeed items={activity} now={now} />
          </div>
        </Card>
      </div>
    </>
  );
}
