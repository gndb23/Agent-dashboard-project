"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, CornerDownLeft, LayoutDashboard, ListChecks, MessageSquarePlus, Plus, Search, Settings, Sparkles, Workflow, X, BarChart3, BellRing, Bot as AgentIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { ConversationView } from "./conversation-view";
import { Composer } from "./composer";
import { useConversation } from "./use-conversation";

type AgentRef = { id: string; name: string; status: string };
type Ctx = { openAsk: (question?: string) => void; openCommand: () => void };
const AssistantCtx = createContext<Ctx>({ openAsk: () => {}, openCommand: () => {} });
export const useAssistant = () => useContext(AssistantCtx);

const SUGGESTIONS = [
  "What happened overnight?",
  "Which agents failed this week, and why?",
  "How much did I spend on agents in the last 7 days?",
  "Which agents haven't run when they should have?",
  "Help me create an agent that summarises my emails every morning",
];

function AskPanel({ open, onClose, pending, clearPending }: { open: boolean; onClose: () => void; pending: string | null; clearPending: () => void }) {
  const conv = useConversation("/api/ask", [], { loadOnMount: true });
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) setTimeout(() => box.current?.focus(), 50);
  }, [open]);
  useEffect(() => {
    if (open && pending && !conv.busy) {
      conv.send(pending);
      clearPending();
    }
  }, [open, pending, conv, clearPending]);

  return (
    <>
      <div className={cn("fixed inset-0 z-40 bg-black/30 transition-opacity md:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")} onClick={onClose} />
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-border bg-surface shadow-pop transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!open}
        aria-label="Ask Agent Ops"
      >
        <div className="flex h-14 items-center justify-between gap-3 border-b border-border px-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-control bg-accent-soft text-accent">
              <Sparkles size={15} />
            </span>
            <div>
              <div className="text-sm font-semibold">Ask Agent Ops</div>
              <div className="text-2xs text-fg-subtle">Answers from your agents, runs, costs and alerts</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => (conv.startFresh(), box.current?.focus())} disabled={conv.busy} title="New conversation">
              <MessageSquarePlus size={13} /> New
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
              <X size={16} />
            </Button>
          </div>
        </div>
        <ConversationView
          messages={conv.messages}
          empty={
            <div className="flex h-full flex-col justify-center">
              <div className="text-base font-semibold text-fg">What would you like to know?</div>
              <p className="mt-1 text-sm text-fg-muted">Ask about any agent, run, cost or alert, or describe an agent you want and I&apos;ll draft it.</p>
              <div className="mt-4 space-y-2">
                {SUGGESTIONS.map((q) => (
                  <button key={q} onClick={() => conv.send(q)} className="block w-full rounded-card border border-border bg-surface-2 px-3.5 py-2.5 text-left text-sm text-fg-muted hover:border-accent hover:text-fg cursor-pointer">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          }
        />
        <Composer ref={box} busy={conv.busy} placeholder="Ask anything about your agents…" onSend={conv.send} onStop={conv.stop} hint="Enter to send · Esc to close · Ctrl+K to search" />
      </aside>
    </>
  );
}

type Item = { id: string; label: string; hint?: string; icon: React.ReactNode; run: () => void; keywords?: string };

function CommandBar({ open, onClose, agents, onAsk }: { open: boolean; onClose: () => void; agents: AgentRef[]; onAsk: (q: string) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => input.current?.focus(), 20);
    }
  }, [open]);

  const go = useCallback((href: string) => () => (router.push(href), onClose()), [router, onClose]);
  const items: Item[] = useMemo(() => {
    const base: Item[] = [
      { id: "new", label: "Create a new agent", icon: <Plus size={15} />, run: go("/agents/new"), keywords: "add register" },
      { id: "overview", label: "Overview", icon: <LayoutDashboard size={15} />, run: go("/") },
      { id: "agents", label: "Agents", icon: <AgentIcon size={15} />, run: go("/agents") },
      { id: "runs", label: "Runs", icon: <ListChecks size={15} />, run: go("/runs"), keywords: "history" },
      { id: "workflow", label: "Workflow", icon: <Workflow size={15} />, run: go("/workflow"), keywords: "links map" },
      { id: "usage", label: "Usage and cost", icon: <BarChart3 size={15} />, run: go("/usage"), keywords: "spend tokens money" },
      { id: "alerts", label: "Alerts", icon: <BellRing size={15} />, run: go("/alerts") },
      { id: "settings", label: "Settings and health", icon: <Settings size={15} />, run: go("/settings"), keywords: "update hooks login sync" },
      ...agents.map((a) => ({ id: `a:${a.id}`, label: a.name, hint: "agent", icon: <Bot size={15} />, run: go(`/agents/${encodeURIComponent(a.id)}`), keywords: a.id })),
    ];
    const term = q.trim().toLowerCase();
    const filtered = term ? base.filter((i) => `${i.label} ${i.keywords ?? ""}`.toLowerCase().includes(term)) : base;
    const ask: Item[] = term ? [{ id: "ask", label: `Ask: “${q.trim()}”`, hint: "Enter", icon: <Sparkles size={15} />, run: () => (onAsk(q.trim()), onClose()) }] : [];
    return term && filtered.length === 0 ? ask : [...ask, ...filtered].slice(0, 12);
  }, [q, agents, go, onAsk, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onClick={onClose}>
      <div className="animate-enter w-full max-w-xl overflow-hidden rounded-card border border-border bg-surface shadow-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Search or ask">
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search size={16} className="text-fg-subtle" />
          <input
            ref={input}
            value={q}
            onChange={(e) => (setQ(e.target.value), setSel(0))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, items.length - 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
              else if (e.key === "Enter") (e.preventDefault(), items[sel]?.run());
              else if (e.key === "Escape") onClose();
            }}
            placeholder="Search agents and pages, or ask a question…"
            className="h-12 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
            aria-label="Search or ask"
          />
          <kbd className="rounded border border-border px-1.5 text-2xs text-fg-subtle">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                onMouseEnter={() => setSel(i)}
                onClick={it.run}
                className={cn("flex w-full items-center gap-3 rounded-control px-3 py-2 text-left text-sm cursor-pointer", i === sel ? "bg-accent-soft text-fg" : "text-fg-muted")}
              >
                <span className={i === sel ? "text-accent" : "text-fg-subtle"}>{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {it.hint && <span className="text-2xs text-fg-subtle">{it.hint}</span>}
                {i === sel && <CornerDownLeft size={12} className="text-fg-subtle" />}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-subtle">Type to search or ask a question</li>}
        </ul>
      </div>
    </div>
  );
}

/** Global "Ask Agent Ops" panel + Ctrl/Cmd+K command bar. */
export function AssistantProvider({ agents, children }: { agents: AgentRef[]; children: React.ReactNode }) {
  const [askOpen, setAskOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const openAsk = useCallback((question?: string) => {
    if (question) setPending(question);
    setAskOpen(true);
  }, []);
  const openCommand = useCallback(() => setCmdOpen(true), []);
  const clearPending = useCallback(() => setPending(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      } else if (e.key === "Escape") {
        setCmdOpen(false);
        setAskOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <AssistantCtx.Provider value={{ openAsk, openCommand }}>
      {children}
      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} agents={agents} onAsk={openAsk} />
      <AskPanel open={askOpen} onClose={() => setAskOpen(false)} pending={pending} clearPending={clearPending} />
    </AssistantCtx.Provider>
  );
}

export function AskButton({ className }: { className?: string }) {
  const { openCommand } = useAssistant();
  return (
    <button
      onClick={openCommand}
      className={cn("flex h-8 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm text-fg-subtle transition-colors hover:border-border-strong hover:text-fg cursor-pointer", className)}
    >
      <Search size={14} />
      <span className="hidden sm:inline">Ask or search…</span>
      <kbd className="ml-auto hidden rounded border border-border px-1 text-2xs sm:inline">Ctrl K</kbd>
    </button>
  );
}

export function AskAboutButton({ question, label = "Ask about this" }: { question: string; label?: string }) {
  const { openAsk } = useAssistant();
  return (
    <Button size="sm" variant="secondary" onClick={() => openAsk(question)}>
      <Sparkles size={13} className="text-accent" /> {label}
    </Button>
  );
}

export function OpenAskButton() {
  const { openAsk } = useAssistant();
  return (
    <Button size="sm" variant="primary" onClick={() => openAsk()}>
      <Sparkles size={13} /> Ask
    </Button>
  );
}
