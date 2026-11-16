import Link from "next/link";
import type { AgentCard, WorkflowEdge } from "@/lib/queries";
import { edgePath, layoutGraph, NODE_H, NODE_W } from "@/lib/workflow";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusDot, STATUS_LABEL } from "./status";

function Node({ card, now, style }: { card: AgentCard; now: number; style?: React.CSSProperties }) {
  return (
    <Link
      href={`/agents/${encodeURIComponent(card.id)}`}
      style={{ width: NODE_W, height: NODE_H, ...style }}
      className={cn(
        "flex flex-col justify-center rounded-card border bg-surface px-4 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-accent hover:shadow-pop",
        card.manifest ? "border-border-strong" : "border-dashed border-border-strong",
        card.status === "running" && "border-status-running/70",
        card.status === "failed" && "border-status-failed/70",
      )}
    >
      <span className="flex items-center gap-2">
        <StatusDot status={card.status} />
        <span className="truncate text-sm font-semibold text-fg">{card.name}</span>
      </span>
      <span className="tabular mt-1 truncate pl-4 text-2xs text-fg-subtle">
        {STATUS_LABEL[card.status]} · {card.lastRun ? `ran ${timeAgo(card.lastRun.startedAt, now)}` : "no runs yet"}
        {card.nextRunAt ? ` · next ${timeAgo(card.nextRunAt, now)}` : ""}
      </span>
    </Link>
  );
}

/** Left-to-right map of which agent hands work to which. Pure server-rendered SVG + HTML. */
export function WorkflowGraph({ cards, edges, now }: { cards: AgentCard[]; edges: WorkflowEdge[]; now: number }) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const layout = layoutGraph(cards.map((c) => c.id), edges);
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const drawn = edges.filter((e) => pos.has(e.from) && pos.has(e.to));
  const extra = drawn.some((e) => pos.get(e.to)!.x <= pos.get(e.from)!.x) ? 48 : 0; // room for loop-back edges

  return (
    <div className="space-y-6">
      {layout.nodes.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-border bg-surface-2/40 shadow-card">
          <div className="relative mx-auto" style={{ width: layout.width, height: layout.height + extra }}>
            <svg width={layout.width} height={layout.height + extra} className="absolute inset-0" role="img" aria-label="Agent workflow links">
              <defs>
                {(["declared", "active"] as const).map((k) => (
                  <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 1 L 9 5 L 0 9 z" fill={k === "active" ? "var(--accent)" : "var(--border-strong)"} />
                  </marker>
                ))}
              </defs>
              {drawn.map((e) => {
                const p = edgePath(pos.get(e.from)!, pos.get(e.to)!);
                const observed = e.kind !== "declared";
                const flowing = byId.get(e.to)?.status === "running" && observed;
                return (
                  <path
                    key={`${e.from}>${e.to}`}
                    d={p.d}
                    fill="none"
                    stroke={observed ? "var(--accent)" : "var(--border-strong)"}
                    strokeWidth={observed ? 2 : 1.5}
                    strokeDasharray={e.kind === "detected" || flowing ? "5 3" : undefined}
                    strokeLinecap="round"
                    markerEnd={`url(#arrow-${observed ? "active" : "declared"})`}
                    className={flowing ? "animate-dash" : undefined}
                  >
                    <title>{`${e.from} → ${e.to} (${e.kind})`}</title>
                  </path>
                );
              })}
            </svg>
            {drawn.map((e) => {
              const p = edgePath(pos.get(e.from)!, pos.get(e.to)!);
              if (e.kind === "declared") return null;
              return (
                <span
                  key={`l-${e.from}>${e.to}`}
                  className="tabular absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border bg-surface px-2 py-0.5 text-2xs font-medium text-fg-muted shadow-card"
                  style={{ left: p.labelX, top: p.labelY }}
                  title={`${e.handoffsTotal} handoff${e.handoffsTotal === 1 ? "" : "s"} in total · last ${timeAgo(e.lastHandoffAt, now)}`}
                >
                  {e.handoffs7d} in 7d
                </span>
              );
            })}
            {layout.nodes.map((n) => (
              <Node key={n.id} card={byId.get(n.id)!} now={now} style={{ position: "absolute", left: n.x, top: n.y }} />
            ))}
          </div>
        </div>
      )}

      {layout.nodes.length > 0 && (
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-fg-muted">
          <li className="flex items-center gap-2">
            <svg width="34" height="8" aria-hidden><line x1="1" y1="4" x2="33" y2="4" stroke="var(--accent)" strokeWidth="2" /></svg>
            Declared and seen happening
          </li>
          <li className="flex items-center gap-2">
            <svg width="34" height="8" aria-hidden><line x1="1" y1="4" x2="33" y2="4" stroke="var(--border-strong)" strokeWidth="1.5" /></svg>
            Declared in a manifest, not seen yet
          </li>
          <li className="flex items-center gap-2">
            <svg width="34" height="8" aria-hidden><line x1="1" y1="4" x2="33" y2="4" stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 3" /></svg>
            Seen happening, not declared
          </li>
        </ul>
      )}

      {layout.unlinked.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-fg">
            Not linked to other agents <span className="ml-1 font-normal text-fg-subtle">{layout.unlinked.length}</span>
          </h2>
          <div className="flex flex-wrap gap-3">
            {layout.unlinked.map((id) => (
              <Node key={id} card={byId.get(id)!} now={now} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
