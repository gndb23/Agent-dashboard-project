import { Activity, BellRing, LayoutDashboard, Rocket } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { getRegistry } from "@/lib/registry/registry";
import { alertCounts, getAgentCards } from "@/lib/queries";
import { NavLink } from "./nav-link";
import { StatusDot } from "./status";

export function Sidebar() {
  const db = getDb();
  const now = Date.now();
  const cards = getAgentCards(db, getRegistry(), now);
  const alerts = alertCounts(db);
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-fg">
          <Activity size={14} strokeWidth={2.5} />
        </span>
        <span className="text-[14px] font-semibold tracking-tight">Agent Ops</span>
      </div>
      <nav className="space-y-0.5 p-2">
        <NavLink href="/" exact>
          <LayoutDashboard size={15} /> Overview
        </NavLink>
        <NavLink href="/alerts">
          <BellRing size={15} /> Alerts
          {alerts.open > 0 && (
            <span className="ml-auto rounded-full bg-status-failed px-1.5 text-[11px] font-semibold leading-[18px] text-white tabular">{alerts.open}</span>
          )}
        </NavLink>
        <NavLink href="/onboarding">
          <Rocket size={15} /> Add an agent
        </NavLink>
      </nav>
      <div className="mt-2 px-4 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">Agents</div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {cards.map((c) => (
          <NavLink key={c.id} href={`/agents/${encodeURIComponent(c.id)}`}>
            <StatusDot status={c.status} />
            <span className={"truncate" + (c.manifest ? "" : " italic")}>{c.name}</span>
          </NavLink>
        ))}
        {cards.length === 0 && <div className="px-2 py-1 text-[12px] text-fg-subtle">No agents yet</div>}
      </nav>
      <div className="border-t border-border px-4 py-3 text-[11px] text-fg-subtle">Event schema v1 · localhost</div>
    </aside>
  );
}
