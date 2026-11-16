"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };

/** Show a toast from anywhere in client code. */
export function toast(text: string, kind: Toast["kind"] = "success") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("agent-ops-toast", { detail: { text, kind } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ text: string; kind: Toast["kind"] }>).detail;
      const id = ++n;
      setItems((l) => [...l.slice(-3), { id, ...d }]);
      setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), d.kind === "error" ? 8000 : 4000);
    };
    window.addEventListener("agent-ops-toast", on);
    return () => window.removeEventListener("agent-ops-toast", on);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="animate-enter pointer-events-auto flex items-start gap-2.5 rounded-card border border-border bg-surface px-4 py-3 text-sm shadow-pop">
          {t.kind === "success" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-status-success" /> : t.kind === "error" ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-status-failed" /> : <Info size={16} className="mt-0.5 shrink-0 text-status-running" />}
          <span className={cn("flex-1", t.kind === "error" ? "text-status-failed-fg" : "text-fg")}>{t.text}</span>
          <button onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))} className="text-fg-subtle hover:text-fg cursor-pointer" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
