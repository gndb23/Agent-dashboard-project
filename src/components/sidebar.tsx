import { Activity, BellRing, LayoutDashboard, Rocket, Workflow } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { getRegistry } from "@/lib/registry/registry";
import { alertCounts, getAgentCards } from "@/lib/queries";
import { NavLink } from "./nav-link";
import { StatusDot } from "./status";

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-control bg-accent text-accent-fg">
        <Activity size={15} strokeWidth={2.6} />
      </span>
      <span className="text-base font-semibold tracking-[-0.01em]">Agent Ops</span>
    </span>
  );
}

export function Sidebar() {
  const db = getDb();
  const now = Date.now();
  const cards = getAgentCards(db, getRegistry(), now);
  const alerts = alertCounts(db);
  return (
    <aside className="sticky top-0 hidden h-screen w-[244px] shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Logo />
      </div>
      <nav className="space-y-0.5 px-2 pt-3">
        <NavLink href="/" exact>
          <LayoutDashboard size={15} /> Overview
        </NavLink>
        <NavLink href="/workflow">
          <Workflow size={15} /> Workflow
        </NavLink>
        <NavLink href="/alerts">
          <BellRing size={15} /> Alerts
          {alerts.open > 0 && (
            <span className="tabular ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-status-failed px-1 text-2xs font-semibold text-white">
              {alerts.open}
            </span>
          )}
        </NavLink>
        <NavLink href="/onboarding">
          <Rocket size={15} /> Add an agent
        </NavLink>
      </nav>
      <div className="eyebrow mt-6 flex items-center justify-between px-4.5">
        <span>Agents</span>
        <span className="tabular font-medium tracking-normal">{cards.length}</span>
      </div>
      <nav className="mt-1.5 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {cards.map((c) => (
          <NavLink key={c.id} href={`/agents/${encodeURIComponent(c.id)}`}>
            <StatusDot status={c.status} />
            <span className={"truncate" + (c.manifest ? "" : " text-fg-subtle")}>{c.name}</span>
            {c.openAlerts > 0 && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-status-failed" title={`${c.openAlerts} open alert(s)`} />}
          </NavLink>
        ))}
        {cards.length === 0 && <div className="px-2.5 py-1 text-xs text-fg-subtle">No agents yet</div>}
      </nav>
      <div className="flex items-center justify-between border-t border-border px-4 py-3 text-2xs text-fg-subtle">
        <span>Event schema v1</span>
        <span className="font-mono">localhost</span>
      </div>
    </aside>
  );
}
