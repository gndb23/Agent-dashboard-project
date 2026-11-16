import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getRegistry } from "@/lib/registry/registry";
import { getAgentCards, getWorkflowEdges } from "@/lib/queries";
import { timeAgo } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page-header";
import { WorkflowGraph } from "@/components/workflow-graph";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CodeBlock } from "@/components/code-block";

export const metadata: Metadata = { title: "Workflow" };

const KIND = {
  both: { label: "declared + seen", variant: "accent" },
  declared: { label: "declared", variant: "neutral" },
  detected: { label: "seen, not declared", variant: "warning" },
} as const;

export default function WorkflowPage() {
  const db = getDb();
  const registry = getRegistry();
  const now = Date.now();
  const cards = getAgentCards(db, registry, now);
  const edges = getWorkflowEdges(db, registry, now);
  const name = (id: string) => registry.byId.get(id)?.name ?? id;

  return (
    <>
      <PageHeader
        title="Workflow"
        description="Which agent hands work to which. Links come from each manifest's triggers list and from handoffs agents actually report."
      />
      {cards.length === 0 ? (
        <EmptyState title="No agents yet">
          <Link href="/onboarding" className="text-accent hover:underline">Add your first agent</Link> to start building the map.
        </EmptyState>
      ) : (
        <WorkflowGraph cards={cards} edges={edges} now={now} />
      )}

      {edges.length > 0 && (
        <Card className="mt-8 min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Links</CardTitle>
            <span className="text-xs text-fg-subtle">{edges.length}</span>
          </CardHeader>
          <Table>
            <THead>
              <tr>
                <TH>From</TH>
                <TH>To</TH>
                <TH>Source</TH>
                <TH className="text-right">Handoffs 7d</TH>
                <TH className="text-right">All time</TH>
                <TH>Last handoff</TH>
              </tr>
            </THead>
            <TBody>
              {edges.map((e) => (
                <TR key={`${e.from}>${e.to}`}>
                  <TD><Link href={`/agents/${encodeURIComponent(e.from)}`} className="text-fg hover:text-accent">{name(e.from)}</Link></TD>
                  <TD><Link href={`/agents/${encodeURIComponent(e.to)}`} className="text-fg hover:text-accent">{name(e.to)}</Link></TD>
                  <TD><Badge variant={KIND[e.kind].variant}>{KIND[e.kind].label}</Badge></TD>
                  <TD className="tabular text-right">{e.handoffs7d}</TD>
                  <TD className="tabular text-right">{e.handoffsTotal}</TD>
                  <TD className="tabular whitespace-nowrap">{timeAgo(e.lastHandoffAt, now)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <section className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Declare a link</h2>
          <p className="mb-3 mt-1 text-sm text-fg-muted">List the agents this one hands work to in its manifest.</p>
          <CodeBlock title="agents/portfolio-research.yaml" code={`triggers:\n  - inbox-triage\n  - pr-reviewer`} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Report a real handoff</h2>
          <p className="mb-3 mt-1 text-sm text-fg-muted">
            When one agent launches another, pass the parent run along. Claude Code agents: set these two variables for the child session.
          </p>
          <CodeBlock
            title="shell"
            code={`AGENT_OPS_PARENT_AGENT_ID=portfolio-research \\\nAGENT_OPS_PARENT_RUN_ID="$PARENT_SESSION_ID" \\\n  claude -p "Triage the briefing"\n\n# other agents: add to any event\n# "parent_run_id": "...", "parent_agent_id": "portfolio-research"`}
          />
        </div>
      </section>
    </>
  );
}
