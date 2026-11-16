import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getRegistry } from "@/lib/registry/registry";
import { searchRuns } from "@/lib/queries";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { RunsTable } from "@/components/runs-table";
import { inputCls } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Runs" };
const RANGES = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, all: 0 } as const;
const PAGE = 50;

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const range = (sp.range && sp.range in RANGES ? sp.range : "7d") as keyof typeof RANGES;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const now = Date.now();
  const reg = getRegistry();
  const db = getDb();
  const { runs, total } = searchRuns(db, { agentId: sp.agent || undefined, status: sp.status || undefined, sinceMs: RANGES[range] ? now - RANGES[range] : undefined, q: sp.q?.trim() || undefined, limit: PAGE, offset: (page - 1) * PAGE }, now);
  const agentIds = (db.$client.prepare(`SELECT DISTINCT agent_id id FROM runs`).all() as { id: string }[]).map((r) => r.id);
  const names = new Map<string, string>([...agentIds.map((i) => [i, i] as [string, string]), ...reg.agents.map((a) => [a.id, a.name] as [string, string])]);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/runs?${p.toString()}`;
  };
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <>
      <PageHeader title="Runs" description="Every run of every agent. Click one to see exactly what it did." />
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/runs">
        <input name="q" defaultValue={sp.q} placeholder="Search title or id…" className={cn(inputCls, "w-56")} />
        <select name="agent" defaultValue={sp.agent ?? ""} className={cn(inputCls, "w-48")}>
          <option value="">All agents</option>
          {[...names].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => (
            <option key={id} value={id}>{n}</option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className={cn(inputCls, "w-40")}>
          <option value="">Any status</option>
          <option value="success">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
          <option value="stalled">Stalled</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="hidden" name="range" value={range} />
        <button className="h-9 rounded-control border border-border-strong bg-surface px-3 text-sm font-medium hover:bg-surface-hover cursor-pointer">Filter</button>
        <div className="ml-auto flex overflow-hidden rounded-control border border-border">
          {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => (
            <Link key={r} href={qs({ range: r, page: undefined })} className={cn("px-3 py-1.5 text-xs", r === range ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-surface-hover")}>
              {r === "all" ? "All" : r}
            </Link>
          ))}
        </div>
      </form>
      {runs.length === 0 ? (
        <EmptyState title="No runs match">Try a longer time range or clear the filters.</EmptyState>
      ) : (
        <Card className="min-w-0 overflow-hidden">
          <RunsTable runs={runs} now={now} agentNames={names} />
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-fg-subtle">
            <span className="tabular">{total} run{total === 1 ? "" : "s"} · page {page} of {pages}</span>
            <span className="flex gap-2">
              {page > 1 && <Link href={qs({ page: String(page - 1) })} className="text-accent hover:underline">← Newer</Link>}
              {page < pages && <Link href={qs({ page: String(page + 1) })} className="text-accent hover:underline">Older →</Link>}
            </span>
          </div>
        </Card>
      )}
    </>
  );
}
