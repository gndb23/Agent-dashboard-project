import type { DB } from "../db/client";
import type { ClaudeChunk } from "../claude/run";
import { addMessage, closeOrphanedReplies, currentConversation, newConversationId, updateMessage } from "./store";

type Runner = (opts: { resumeSessionId: string | null; onChunk: (c: ClaudeChunk) => void }) => Promise<unknown>;

/**
 * Stores the user's message, runs one turn, saves the reply as it streams, and returns an
 * NDJSON stream for the browser. If the browser goes away, the turn keeps running and is saved.
 */
export function streamConversation(db: DB, opts: { threadId: string; message: string; newConversation?: boolean; run: Runner }): Response {
  closeOrphanedReplies(db, opts.threadId);
  const current = opts.newConversation ? { conversationId: null, sessionId: null } : currentConversation(db, opts.threadId);
  const conversationId = current.conversationId ?? newConversationId();
  addMessage(db, { agentId: opts.threadId, conversationId, role: "user", text: opts.message, status: "done" });
  const replyId = addMessage(db, { agentId: opts.threadId, conversationId, role: "assistant", text: "", status: "streaming" });

  const encoder = new TextEncoder();
  let text = "";
  let errorText = "";
  const tools: string[] = [];
  let sessionId: string | null = null;
  let costUsd: number | null = null;
  let lastSave = 0;
  const save = (status: "streaming" | "done" | "error" | "stopped") =>
    updateMessage(db, replyId, { text: status === "error" && errorText ? (text ? `${text}\n\n${errorText}` : errorText) : text, tools, status, sessionId, costUsd });

  const stream = new ReadableStream({
    start(controller) {
      let open = true;
      const send = (c: Record<string, unknown>) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(c) + "\n"));
        } catch {
          open = false;
        }
      };
      send({ type: "start", replyId, conversationId });
      opts
        .run({
          resumeSessionId: current.sessionId,
          onChunk: (c) => {
            if (c.type === "text") text += c.text;
            else if (c.type === "tool") tools.push(c.summary ? `${c.name} · ${c.summary}` : c.name);
            else if (c.type === "session") sessionId = c.sessionId;
            else if (c.type === "result") costUsd = c.costUsd ?? costUsd;
            else if (c.type === "error") errorText = c.message;
            if (c.type === "done") save(c.status);
            else if (Date.now() - lastSave > 1000) {
              lastSave = Date.now();
              save("streaming");
            }
            // Only what the browser needs (tool inputs can be large).
            if (c.type === "text" || c.type === "error" || c.type === "done") send(c);
            else if (c.type === "tool") send({ type: "tool", name: c.name, summary: c.summary });
          },
        })
        .finally(() => {
          if (open) {
            try {
              controller.close();
            } catch {
              /* closed */
            }
          }
        });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
}
