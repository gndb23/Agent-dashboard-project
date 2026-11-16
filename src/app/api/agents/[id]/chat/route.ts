import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getRegistry } from "@/lib/registry/registry";
import { chatAvailability, isChatRunning, runChatTurn, stopChat, type ChatChunk } from "@/lib/chat/runner";
import { addMessage, closeOrphanedReplies, currentConversation, listMessages, newConversationId, updateMessage } from "@/lib/chat/store";
import { localOnlyError } from "@/lib/local-only";

export const dynamic = "force-dynamic";
const MAX_MESSAGE = 20_000;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const { id } = await ctx.params;
  const db = getDb();
  if (!isChatRunning(id)) closeOrphanedReplies(db, id);
  return NextResponse.json({ messages: listMessages(db, id), running: isChatRunning(id) });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const { id } = await ctx.params;
  return NextResponse.json({ stopped: stopChat(id) });
}

/** Send a message; the reply streams back as NDJSON (one ChatChunk per line). */
export async function POST(req: Request, ctx: Ctx) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { message?: unknown; new_conversation?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });
  if (message.length > MAX_MESSAGE) return NextResponse.json({ error: `message is too long (max ${MAX_MESSAGE} characters)` }, { status: 400 });

  const manifest = getRegistry().byId.get(id);
  const avail = chatAvailability(manifest);
  if (!avail.enabled) return NextResponse.json({ error: avail.reason }, { status: 409 });
  if (isChatRunning(id)) return NextResponse.json({ error: "This agent is already answering a message." }, { status: 409 });

  const db = getDb();
  closeOrphanedReplies(db, id);
  const current = body?.new_conversation ? { conversationId: null, sessionId: null } : currentConversation(db, id);
  const conversationId = current.conversationId ?? newConversationId();
  addMessage(db, { agentId: id, conversationId, role: "user", text: message, status: "done" });
  const replyId = addMessage(db, { agentId: id, conversationId, role: "assistant", text: "", status: "streaming" });

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
      const send = (c: ChatChunk | { type: "start"; replyId: number; conversationId: string }) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(c) + "\n"));
        } catch {
          open = false; // browser went away; keep running so the reply is still saved
        }
      };
      send({ type: "start", replyId, conversationId });
      runChatTurn({
        agentId: id,
        projectDir: avail.projectDir,
        permissionMode: avail.permissionMode,
        message,
        resumeSessionId: current.sessionId,
        agentName: manifest?.name ?? id,
        instructions: avail.instructions,
        addDirs: avail.addDirs,
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
          if (c.type !== "result") send(c);
        },
      }).finally(() => {
        if (open) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
