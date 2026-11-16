import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getRegistry } from "@/lib/registry/registry";
import { topRuns, usageByAgent, usageDaily } from "@/lib/queries";
import { compact, duration, usd, pct } from "@/lib/format";
import { PageHeader, EmptyState, SectionTitle } from "@/components/page-header";
import { Kpi } from "@/components/kpi";
import { UsageChart } from "@/components/charts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { RunsTable } from "@/components/runs-table";
import { AskAboutButton } from "@/components/assistant";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Usage" };
const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range: r } = await searchParams;
  const range = (r && r in RANGES ? r : "30d") as keyof typeof RANGES;
  const days = RANGES[range];
  const now = Date.now();
  const since = now - days * 86_400_000;
  const db = getDb();
  const reg = getRegistry();
  const rows = usageByAgent(db, since);
  const daily = usageDaily(db, Math.min(days, 60), now);
  const totals = rows.reduce(
    (a, x) => ({ cost: a.cost + x.cost, runs: a.runs + x.runs, failed: a.failed + x.failed, tokens: a.tokens + x.tokensIn + x.tokensOut }),
    { cost: 0, runs: 0, failed: 0, tokens: 0 },
  );
  const names = new Map(reg.agents.map((a) => [a.id, a.name]));
  const pricey = topRuns(db, since, 8, now);
  return (
    <>
      <PageHeader
        title="Usage"
        description="What your agents cost and how much they work. Costs are estimates from token counts."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AskAboutButton question={`Explain my agent spending over the last ${days} days: which agents cost the most, any spikes, and how I could reduce it.`} label="Explain my costs" />
            <div className="flex overflow-hidden rounded-control border border-border">
              {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => (
                <Link key={k} href={`/usage?range=${k}`} className={cn("px-3 py-1.5 text-xs", k === range ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-surface-hover")}>
                  {k}
                </Link>
              ))}
            </div>
          </div>
        }
      />
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label={`Est. cost · ${range}`} value={usd(totals.cost)} hint={`${usd(totals.cost / days)} per day`} />
        <Kpi label="Runs" value={compact(totals.runs)} hint={`${Math.round(totals.runs / days)} per day`} />
        <Kpi label="Failed" value={totals.failed} tone={totals.failed ? "failed" : undefined} hint={totals.runs ? `${pct(totals.failed / totals.runs)} of runs` : undefined} />
        <Kpi label="Tokens" value={compact(totals.tokens)} hint="input + output" />
      </section>
      {totals.runs === 0 ? (
        <div className="mt-8">
          <EmptyState title="No runs in this period">Usage appears once your agents run.</EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-8">
            <UsageChart data={daily} />
          </div>
          <div className="mt-8">
            <SectionTitle>By agent</SectionTitle>
            <Card className="min-w-0 overflow-hidden">
              <Table>
                <THead>
                  <tr>
                    <TH>Agent</TH>
                    <TH className="text-right">Runs</TH>
                    <TH className="text-right">Failed</TH>
                    <TH className="text-right">Avg duration</TH>
                    <TH className="text-right">Tokens</TH>
                    <TH className="text-right">Est. cost</TH>
                    <TH className="w-40">Share of cost</TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((x) => (
                    <TR key={x.agentId}>
                      <TD>
                        <Link href={`/agents/${encodeURIComponent(x.agentId)}`} className="text-fg hover:text-accent">
                          {names.get(x.agentId) ?? x.agentId}
                        </Link>
                      </TD>
                      <TD className="tabular text-right">{x.runs}</TD>
                      <TD className={cn("tabular text-right", x.failed > 0 && "text-status-failed-fg")}>{x.failed}</TD>
                      <TD className="tabular text-right">{duration(x.avgDurationMs ? Math.round(x.avgDurationMs) : null)}</TD>
                      <TD className="tabular text-right">{compact(x.tokensIn + x.tokensOut)}</TD>
                      <TD className="tabular text-right font-medium text-fg">{usd(x.cost)}</TD>
                      <TD>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${totals.cost ? Math.max(2, (x.cost / totals.cost) * 100) : 0}%` }} />
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          </div>
          {pricey.length > 0 && (
            <Card className="mt-8 min-w-0 overflow-hidden">
              <CardHeader>
                <CardTitle>Most expensive runs</CardTitle>
              </CardHeader>
              <RunsTable runs={pricey} now={now} agentNames={names} />
            </Card>
          )}
        </>
      )}
    </>
  );
}
