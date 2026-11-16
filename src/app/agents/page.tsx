import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { getRegistry } from "@/lib/registry/registry";
import { getAgentCards } from "@/lib/queries";
import { pct, timeAgo, usd } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusDot, STATUS_LABEL } from "@/components/status";
import { RunStrip } from "@/components/run-strip";
import { RunAgentButton } from "@/components/agent-actions";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  const db = getDb();
  const reg = getRegistry();
  const now = Date.now();
  const cards = getAgentCards(db, reg, now);
  const cost = new Map(
    (db.$client.prepare(`SELECT agent_id id, SUM(cost_usd) c FROM runs WHERE started_at >= ? GROUP BY 1`).all(now - 7 * 86_400_000) as { id: string; c: number }[]).map((r) => [r.id, r.c]),
  );
  return (
    <>
      <PageHeader
        title="Agents"
        description="Every agent in one place: your Claude scheduled tasks appear here automatically, and you can create new ones."
        actions={
          <Link href="/agents/new" className="inline-flex h-8 items-center gap-1.5 rounded-control bg-accent px-3 text-sm font-semibold text-accent-fg hover:opacity-90">
            <Plus size={14} /> New agent
          </Link>
        }
      />
      {cards.length === 0 ? (
        <EmptyState title="No agents yet">
          <Link href="/agents/new" className="text-accent hover:underline">Create your first agent</Link>, or make a scheduled task in the Claude app. It shows up here by itself.
        </EmptyState>
      ) : (
        <Card className="min-w-0 overflow-hidden">
          <Table>
            <THead>
              <tr>
                <TH>Agent</TH>
                <TH>Status</TH>
                <TH className="hidden lg:table-cell">Recent runs</TH>
                <TH>Last run</TH>
                <TH>Next run</TH>
                <TH className="text-right">Success 7d</TH>
                <TH className="text-right">Cost 7d</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {cards.map((c) => (
                <TR key={c.id}>
                  <TD className="max-w-[320px]">
                    <Link href={`/agents/${encodeURIComponent(c.id)}`} className="block truncate font-medium text-fg hover:text-accent">{c.name}</Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {!c.manifest ? (
                        <Badge variant="outline">Unregistered</Badge>
                      ) : c.manifest.origin ? (
                        <Badge variant="accent">Claude task{c.manifest.origin.enabled === false ? " · paused" : ""}</Badge>
                      ) : (
                        <Badge>{c.manifest.type}</Badge>
                      )}
                      {c.manifest?.description && <span className="truncate text-2xs text-fg-subtle">{c.manifest.description}</span>}
                    </div>
                  </TD>
                  <TD>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg"><StatusDot status={c.status} /> {STATUS_LABEL[c.status]}</span>
                    {c.openAlerts > 0 && <div className="text-2xs text-status-failed-fg">{c.openAlerts} open alert{c.openAlerts > 1 ? "s" : ""}</div>}
                  </TD>
                  <TD className="hidden w-48 lg:table-cell"><RunStrip runs={c.recentRuns} slots={20} height={22} /></TD>
                  <TD className="tabular whitespace-nowrap">{timeAgo(c.lastRun?.startedAt, now)}</TD>
                  <TD className="tabular whitespace-nowrap">{c.nextRunAt ? timeAgo(c.nextRunAt, now) : <span className="text-fg-subtle">on demand</span>}</TD>
                  <TD className="tabular text-right">{pct(c.successRate7d)}</TD>
                  <TD className="tabular text-right">{usd(cost.get(c.id) ?? 0)}</TD>
                  <TD className="text-right">{c.manifest?.type === "claude-code" && <RunAgentButton agentId={c.id} compact />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
