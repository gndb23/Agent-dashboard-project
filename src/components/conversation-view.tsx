"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Sparkles, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import type { Msg } from "./use-conversation";

/** Pulls ```agent {...}``` drafts out of an assistant reply (see src/lib/assistant/context.ts). */
function drafts(text: string): { json: Record<string, unknown>; raw: string }[] {
  const out: { json: Record<string, unknown>; raw: string }[] = [];
  for (const m of text.matchAll(/```agent\s*\n([\s\S]*?)```/g)) {
    try {
      const j = JSON.parse(m[1]);
      if (j && typeof j.name === "string") out.push({ json: j, raw: m[0] });
    } catch {
      /* incomplete while streaming */
    }
  }
  return out;
}

export function encodeDraft(d: Record<string, unknown>) {
  const s = JSON.stringify(d);
  return typeof window === "undefined" ? Buffer.from(s).toString("base64url") : btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function ConversationView({ messages, empty }: { messages: Msg[]; empty?: React.ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
      {messages.length === 0 && empty}
      {messages.map((m) => {
        if (m.role === "user") {
          return (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-accent-fg">{m.text}</div>
            </div>
          );
        }
        const ds = m.status === "streaming" ? [] : drafts(m.text);
        let body = m.text.trim().replace(/\n{3,}/g, "\n\n");
        for (const d of ds) body = body.replace(d.raw, "");
        return (
          <div key={m.id} className="max-w-[94%] space-y-2">
            {m.tools.length > 0 && (
              <details className="group text-2xs text-fg-subtle" open={m.status === "streaming"}>
                <summary className="flex cursor-pointer list-none items-center gap-1.5 hover:text-fg-muted">
                  <Wrench size={11} /> {m.tools.length} step{m.tools.length === 1 ? "" : "s"} · {m.status === "streaming" ? m.tools[m.tools.length - 1] : "show"}
                </summary>
                <ul className="mt-1 space-y-0.5 pl-4">
                  {m.tools.map((t, i) => (
                    <li key={i} className="truncate font-mono">{t}</li>
                  ))}
                </ul>
              </details>
            )}
            {(body || m.status === "streaming") && (
              <div
                className={cn(
                  "break-words rounded-2xl rounded-bl-md border px-3.5 py-2.5",
                  m.status === "error" ? "border-status-failed/35 bg-status-failed/8 text-status-failed-fg whitespace-pre-wrap text-sm" : "border-border bg-surface-2",
                )}
              >
                {m.status === "error" ? body : <Markdown text={body} />}
                {m.status === "streaming" && (
                  <span className="mt-1 inline-flex gap-[3px]" aria-label="Replying">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-1 w-1 animate-bounce rounded-full bg-fg-subtle" style={{ animationDelay: `${i * 120}ms` }} />
                    ))}
                  </span>
                )}
              </div>
            )}
            {ds.map((d, i) => (
              <div key={i} className="rounded-card border border-accent/40 bg-accent-soft p-3.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-fg">
                  <Sparkles size={14} className="text-accent" /> {String(d.json.name)}
                </div>
                {typeof d.json.description === "string" && <p className="mt-1 text-xs text-fg-muted">{d.json.description}</p>}
                {typeof d.json.schedule === "string" && d.json.schedule && <p className="mt-1 text-xs text-fg-subtle">Schedule: {d.json.schedule}</p>}
                <Link
                  href={`/agents/new?draft=${encodeDraft(d.json)}`}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-control bg-accent px-3 text-sm font-semibold text-accent-fg hover:opacity-90"
                >
                  Create this agent
                </Link>
                <span className="ml-2 text-2xs text-fg-subtle">You can review and change everything first.</span>
              </div>
            ))}
            {m.status === "stopped" && <div className="text-2xs text-fg-subtle">Stopped</div>}
          </div>
        );
      })}
    </div>
  );
}
