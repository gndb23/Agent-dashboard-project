import Link from "next/link";
import { Activity, BarChart3, BellRing, Bot, LayoutDashboard, ListChecks, Plus, Settings, Workflow } from "lucide-react";
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
      <div className="px-3 pt-3">
        <Link href="/agents/new" className="flex h-8 w-full items-center justify-center gap-1.5 rounded-control bg-accent text-sm font-semibold text-accent-fg hover:opacity-90">
          <Plus size={14} strokeWidth={2.5} /> New agent
        </Link>
      </div>
      <nav className="space-y-0.5 px-2 pt-3">
        <NavLink href="/" exact>
          <LayoutDashboard size={15} /> Overview
        </NavLink>
        <NavLink href="/agents" exact>
          <Bot size={15} /> Agents
        </NavLink>
        <NavLink href="/runs">
          <ListChecks size={15} /> Runs
        </NavLink>
        <NavLink href="/workflow">
          <Workflow size={15} /> Workflow
        </NavLink>
        <NavLink href="/usage">
          <BarChart3 size={15} /> Usage
        </NavLink>
        <NavLink href="/alerts">
          <BellRing size={15} /> Alerts
          {alerts.open > 0 && (
            <span className="tabular ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-status-failed px-1 text-2xs font-semibold text-white">{alerts.open}</span>
          )}
        </NavLink>
        <NavLink href="/settings">
          <Settings size={15} /> Settings
        </NavLink>
      </nav>
      <div className="eyebrow mt-6 flex items-center justify-between px-4.5">
        <span>Agents</span>
        <span className="tabular font-medium tracking-normal">{cards.filter((c) => c.manifest).length}</span>
      </div>
      <nav className="mt-1.5 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {cards
          .filter((c) => c.manifest)
          .map((c) => (
            <NavLink key={c.id} href={`/agents/${encodeURIComponent(c.id)}`}>
              <StatusDot status={c.status} />
              <span className="truncate">{c.name}</span>
              {c.openAlerts > 0 && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-status-failed" title={`${c.openAlerts} open alert(s)`} />}
            </NavLink>
          ))}
        {cards.filter((c) => c.manifest).length === 0 && <div className="px-2.5 py-1 text-xs text-fg-subtle">No agents yet</div>}
        {cards.some((c) => !c.manifest) && (
          <details className="group pt-3">
            <summary className="eyebrow flex cursor-pointer list-none items-center justify-between px-2.5 py-1 hover:text-fg-muted">
              <span>Other activity</span>
              <span className="tabular font-medium tracking-normal">{cards.filter((c) => !c.manifest).length}</span>
            </summary>
            <div className="mt-1 space-y-0.5">
              {cards
                .filter((c) => !c.manifest)
                .map((c) => (
                  <NavLink key={c.id} href={`/agents/${encodeURIComponent(c.id)}`}>
                    <StatusDot status={c.status} />
                    <span className="truncate text-fg-subtle">{c.name}</span>
                  </NavLink>
                ))}
            </div>
          </details>
        )}
      </nav>
      <div className="flex items-center justify-between border-t border-border px-4 py-3 text-2xs text-fg-subtle">
        <span>Local only</span>
        <span className="font-mono">localhost:4321</span>
      </div>
    </aside>
  );
}
