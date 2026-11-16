"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Msg = {
  id: number | string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  status: "done" | "streaming" | "error" | "stopped";
  costUsd?: number | null;
};
type Chunk =
  | { type: "start"; replyId: number }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary?: string }
  | { type: "error"; message: string }
  | { type: "done"; status: Msg["status"] };

/** Streams a conversation from an NDJSON endpoint (agent chat or Ask). */
export function useConversation(api: string, initial: Msg[] = [], opts: { loadOnMount?: boolean } = {}) {
  const [messages, setMessages] = useState<Msg[]>(initial);
  // If the panel is (re)mounted while a reply is still streaming, stay busy until it finishes.
  const [busy, setBusy] = useState(() => initial.some((m) => m.status === "streaming"));
  const fresh = useRef(false);

  const patchLast = (fn: (m: Msg) => Msg) => setMessages((l) => (l.length ? [...l.slice(0, -1), fn(l[l.length - 1])] : l));

  const load = useCallback(async () => {
    try {
      const res = await fetch(api);
      if (!res.ok) return;
      const d = (await res.json()) as { messages: Msg[]; running: boolean };
      setMessages(d.messages);
      setBusy(d.running);
      return d.running;
    } catch {
      return false;
    }
  }, [api]);

  // Pick up a reply that's still streaming from an earlier page view, or load history.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const poll = async () => {
      const running = await load();
      if (!cancelled && running) timer = setTimeout(poll, 1500);
    };
    if (opts.loadOnMount || initial.some((m) => m.status === "streaming")) poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || busy) return;
      setBusy(true);
      const isFresh = fresh.current;
      fresh.current = false;
      setMessages((l) => [
        ...(isFresh ? [] : l),
        { id: `u-${Date.now()}`, role: "user", text: t, tools: [], status: "done" },
        { id: `a-${Date.now()}`, role: "assistant", text: "", tools: [], status: "streaming" },
      ]);
      try {
        const res = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: t, new_conversation: isFresh }) });
        if (!res.ok || !res.body) {
          const err = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${res.status})`;
          patchLast((m) => ({ ...m, text: err, status: "error" }));
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            const c = JSON.parse(line) as Chunk;
            if (c.type === "text") patchLast((m) => ({ ...m, text: m.text + c.text }));
            else if (c.type === "tool") patchLast((m) => ({ ...m, tools: [...m.tools, c.summary ? `${c.name} · ${c.summary}` : c.name] }));
            else if (c.type === "error") patchLast((m) => ({ ...m, text: m.text ? `${m.text}\n\n${c.message}` : c.message, status: "error" }));
            else if (c.type === "done") patchLast((m) => ({ ...m, status: m.status === "error" ? "error" : c.status }));
          }
        }
      } catch {
        patchLast((m) => ({ ...m, text: m.text || "Lost connection to the dashboard.", status: "error" }));
      } finally {
        setBusy(false);
        patchLast((m) => (m.status === "streaming" ? { ...m, status: "done" } : m));
      }
    },
    [api, busy],
  );

  const stop = useCallback(async () => {
    await fetch(api, { method: "DELETE" }).catch(() => {});
  }, [api]);

  const startFresh = useCallback(() => {
    fresh.current = true;
    setMessages([]);
  }, []);

  return { messages, busy, send, stop, startFresh };
}
