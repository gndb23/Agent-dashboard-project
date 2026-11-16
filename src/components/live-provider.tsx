"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type LiveState = { connected: boolean; lastEventAt: number | null };
const LiveContext = createContext<LiveState>({ connected: false, lastEventAt: null });
export const useLive = () => useContext(LiveContext);

/**
 * Subscribes to /api/stream (SSE) and re-renders server components when data changes.
 * Refreshes are throttled so bursts of events cause at most ~1 refresh per second.
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<LiveState>({ connected: false, lastEventAt: null });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(0);

  useEffect(() => {
    const refresh = () => {
      if (pending.current) return;
      const wait = Math.max(0, 1000 - (Date.now() - last.current));
      pending.current = setTimeout(() => {
        pending.current = null;
        last.current = Date.now();
        router.refresh();
      }, wait);
    };

    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      es = new EventSource("/api/stream");
      es.onopen = () => setState((s) => ({ ...s, connected: true }));
      es.onmessage = (m) => {
        try {
          const msg = JSON.parse(m.data) as { kind: string };
          if (msg.kind === "ping" || msg.kind === "hello") return;
          setState({ connected: true, lastEventAt: Date.now() });
          refresh();
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        setState((s) => ({ ...s, connected: false }));
        es?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    // Keeps relative times and time-based statuses fresh even when nothing happens.
    const tick = setInterval(refresh, 30_000);
    return () => {
      es?.close();
      clearTimeout(retry);
      clearInterval(tick);
      if (pending.current) clearTimeout(pending.current);
    };
  }, [router]);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export function LiveIndicator() {
  const { connected, lastEventAt } = useLive();
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!lastEventAt) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 600);
    return () => clearTimeout(t);
  }, [lastEventAt]);
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-fg-muted" title={connected ? "Receiving live updates" : "Reconnecting…"}>
      <span
        className={
          "h-1.5 w-1.5 rounded-full transition-transform " +
          (connected ? "bg-status-success" : "bg-status-idle") +
          (flash ? " scale-150" : "")
        }
      />
      {connected ? "Live" : "Offline"}
    </span>
  );
}
