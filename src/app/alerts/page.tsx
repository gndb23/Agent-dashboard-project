import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listAlerts } from "@/lib/queries";
import { getRegistry } from "@/lib/registry/registry";
import { dateTime, timeAgo } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AlertActions } from "@/components/actions";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "active", label: "Active" },
  { key: "open", label: "Open" },
  { key: "acknowledged", label: "Acknowledged" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
] as const;

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "active" } = await searchParams;
  const db = getDb();
  const now = Date.now();
  const registry = getRegistry();
  const all = listAlerts(db, undefined, 500);
  const counts = {
    active: all.filter((a) => a.status !== "resolved").length,
    open: all.filter((a) => a.status === "open").length,
    acknowledged: all.filter((a) => a.status === "acknowledged").length,
    resolved: all.filter((a) => a.status === "resolved").length,
    all: all.length,
  };
  const rows = all.filter((a) => (status === "all" ? true : status === "active" ? a.status !== "resolved" : a.status === status));

  return (
    <>
      <PageHeader title="Alerts" description="Raised by alert_rules in agent manifests. Alerts auto-resolve when the condition clears." />
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/alerts?status=${t.key}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px]",
              status === t.key ? "border-accent font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label} <span className="ml-1 text-fg-subtle tabular">{counts[t.key]}</span>
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={status === "active" ? "All clear" : "Nothing here"}>
          {status === "active" ? "No open or acknowledged alerts." : "No alerts match this filter."}
        </EmptyState>
      ) : (
        <Card className="min-w-0 overflow-hidden">
          <Table>
            <THead>
              <tr>
                <TH>Severity</TH>
                <TH>Agent</TH>
                <TH>Alert</TH>
                <TH>Triggered</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((a) => (
                <TR key={a.id} className={a.status === "resolved" ? "opacity-60" : undefined}>
                  <TD><Badge variant={a.severity === "critical" ? "failed" : "warning"}>{a.severity}</Badge></TD>
                  <TD>
                    <Link href={`/agents/${encodeURIComponent(a.agentId)}`} className="text-fg hover:text-accent">
                      {registry.byId.get(a.agentId)?.name ?? a.agentId}
                    </Link>
                  </TD>
                  <TD>
                    <div className="text-fg">{a.message}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-fg-subtle">
                      {a.ruleKey}
                      {a.runId && (
                        <> · <Link href={`/runs/${encodeURIComponent(a.runId)}`} className="hover:text-accent">view run</Link></>
                      )}
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap tabular" title={dateTime(a.triggeredAt)}>{timeAgo(a.triggeredAt, now)}</TD>
                  <TD>
                    <Badge variant={a.status === "open" ? "failed" : a.status === "acknowledged" ? "warning" : "success"}>{a.status}</Badge>
                    {a.resolvedAt && <div className="mt-0.5 text-[11px] text-fg-subtle">{timeAgo(a.resolvedAt, now)}</div>}
                  </TD>
                  <TD className="text-right"><AlertActions id={a.id} status={a.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
