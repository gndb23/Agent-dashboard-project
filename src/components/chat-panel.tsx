"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, MessageSquarePlus, Square, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

type Msg = {
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
  | { type: "done"; status: Msg["status"] }
  | { type: "session" };

const MODE_NOTE: Record<string, string> = {
  default: "Read-only: it can read and answer, but edits and shell commands are denied.",
  plan: "Plan mode: it can explore and propose, but not change anything.",
  acceptEdits: "Can edit files in the project folder.",
};

/** Chat with one agent. Each message runs Claude Code in the agent's project folder on this machine. */
export function ChatPanel({
  agentId, agentName, enabled, disabledReason, permissionMode, projectDir, initialMessages,
}: {
  agentId: string; agentName: string; enabled: boolean; disabledReason?: string; permissionMode?: string; projectDir?: string; initialMessages: Msg[];
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [notice, setNotice] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const api = `/api/agents/${encodeURIComponent(agentId)}/chat`;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Pick up a reply that is still streaming from an earlier page view.
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(api);
        if (!res.ok) return;
        const data = (await res.json()) as { messages: Msg[]; running: boolean };
        if (cancelled) return;
        setMessages(data.messages);
        setBusy(data.running);
        if (data.running) timer = setTimeout(poll, 1500);
      } catch {
        /* offline */
      }
    };
    if (initialMessages.some((m) => m.status === "streaming")) poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const patchLast = (fn: (m: Msg) => Msg) => setMessages((list) => (list.length ? [...list.slice(0, -1), fn(list[list.length - 1])] : list));

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !enabled) return;
    setInput("");
    setNotice("");
    setBusy(true);
    const base = fresh ? [] : messages;
    setMessages([
      ...base,
      { id: `u-${Date.now()}`, role: "user", text, tools: [], status: "done" },
      { id: `a-${Date.now()}`, role: "assistant", text: "", tools: [], status: "streaming" },
    ]);
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, new_conversation: fresh }),
      });
      setFresh(false);
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
      box.current?.focus();
    }
  }, [api, busy, enabled, fresh, input, messages]);

  const stop = async () => {
    await fetch(api, { method: "DELETE" }).catch(() => {});
  };

  const startFresh = () => {
    setFresh(true);
    setMessages([]);
    setNotice("New conversation: the next message starts a fresh session.");
    box.current?.focus();
  };

  return (
    <div className="flex h-[560px] flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Chat with {agentName}</h2>
          {enabled && projectDir && <div className="truncate font-mono text-2xs text-fg-subtle" title={projectDir}>{projectDir}</div>}
        </div>
        {enabled && (
          <Button size="sm" variant="ghost" onClick={startFresh} disabled={busy} title="Start a new conversation">
            <MessageSquarePlus size={13} /> New
          </Button>
        )}
      </div>

      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
        {!enabled && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="text-sm font-medium text-fg">Chat isn&apos;t set up for this agent</div>
            <p className="mt-1.5 max-w-xs text-sm text-fg-muted">{disabledReason}</p>
            <pre className="mt-3 rounded-control border border-border bg-surface-2 px-3 py-2 text-left font-mono text-2xs text-fg-muted">{`type: claude-code\nproject_dir: /absolute/path/to/project`}</pre>
          </div>
        )}
        {enabled && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="text-sm font-medium text-fg">Ask {agentName} anything</div>
            <p className="mt-1.5 max-w-xs text-sm text-fg-muted">
              Your message runs Claude Code in this agent&apos;s project folder on this computer. {MODE_NOTE[permissionMode ?? "default"]}
            </p>
            {notice && <p className="mt-3 text-xs text-fg-subtle">{notice}</p>}
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-accent-fg">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="max-w-[92%] space-y-2">
              {m.tools.length > 0 && (
                <ul className="space-y-1">
                  {m.tools.map((t, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-2xs text-fg-subtle">
                      <Wrench size={11} className="shrink-0" />
                      <span className="truncate font-mono">{t}</span>
                    </li>
                  ))}
                </ul>
              )}
              {(m.text || m.status === "streaming") && (
                <div
                  className={cn(
                    "whitespace-pre-wrap break-words rounded-2xl rounded-bl-md border px-3.5 py-2 text-sm",
                    m.status === "error" ? "border-status-failed/35 bg-status-failed/8 text-status-failed-fg" : "border-border bg-surface-2 text-fg",
                  )}
                >
                  {m.text.trim()}
                  {m.status === "streaming" && (
                    <span className="ml-0.5 inline-flex translate-y-[1px] gap-[3px] align-baseline" aria-label="Agent is replying">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="h-1 w-1 animate-bounce rounded-full bg-fg-subtle" style={{ animationDelay: `${i * 120}ms` }} />
                      ))}
                    </span>
                  )}
                </div>
              )}
              {m.status === "stopped" && <div className="text-2xs text-fg-subtle">Stopped</div>}
            </div>
          ),
        )}
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className={cn("flex items-end gap-2 rounded-card border bg-surface-2 p-1.5 pl-3.5 transition-colors focus-within:border-accent", enabled ? "border-border-strong" : "border-border opacity-60")}>
          <textarea
            ref={box}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            disabled={!enabled}
            placeholder={enabled ? `Message ${agentName}…` : "Chat is not available"}
            aria-label={`Message ${agentName}`}
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm text-fg outline-none placeholder:text-fg-subtle [field-sizing:content]"
          />
          {busy ? (
            <Button type="button" size="icon" variant="secondary" onClick={stop} aria-label="Stop" title="Stop">
              <Square size={12} fill="currentColor" />
            </Button>
          ) : (
            <Button type="submit" size="icon" variant="primary" disabled={!enabled || !input.trim()} aria-label="Send" title="Send (Enter)">
              <ArrowUp size={15} strokeWidth={2.5} />
            </Button>
          )}
        </div>
        <div className="mt-1.5 px-1 text-2xs text-fg-subtle">Enter to send · Shift+Enter for a new line</div>
      </form>
    </div>
  );
}
