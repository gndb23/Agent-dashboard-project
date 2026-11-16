import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getRegistry } from "@/lib/registry/registry";
import { chatAvailability, isChatRunning, runChatTurn, stopChat } from "@/lib/chat/runner";
import { closeOrphanedReplies, listMessages } from "@/lib/chat/store";
import { streamConversation } from "@/lib/chat/stream";
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

  return streamConversation(getDb(), {
    threadId: id,
    message,
    newConversation: Boolean(body?.new_conversation),
    run: ({ resumeSessionId, onChunk }) =>
      runChatTurn({
        agentId: id,
        projectDir: avail.projectDir,
        permissionMode: avail.permissionMode,
        message,
        resumeSessionId,
        agentName: manifest?.name ?? id,
        instructions: avail.instructions,
        addDirs: avail.addDirs,
        onChunk,
      }),
  });
}
