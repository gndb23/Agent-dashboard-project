import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getRegistry } from "@/lib/registry/registry";
import { closeOrphanedReplies, listMessages } from "@/lib/chat/store";
import { streamConversation } from "@/lib/chat/stream";
import { isRunning, runClaude, stopRun } from "@/lib/claude/run";
import { writeAssistantContext } from "@/lib/assistant/context";
import { localOnlyError } from "@/lib/local-only";

export const dynamic = "force-dynamic";
const THREAD = "__ask__";
const KEY = "ask";

export async function GET(req: Request) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const db = getDb();
  if (!isRunning(KEY)) closeOrphanedReplies(db, THREAD);
  return NextResponse.json({ messages: listMessages(db, THREAD), running: isRunning(KEY) });
}

export async function DELETE(req: Request) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  return NextResponse.json({ stopped: stopRun(KEY) });
}

/** Ask a question about your agents. The answer streams back as NDJSON. */
export async function POST(req: Request) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { message?: unknown; new_conversation?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Type a question first." }, { status: 400 });
  if (message.length > 20_000) return NextResponse.json({ error: "That message is too long." }, { status: 400 });
  if (isRunning(KEY)) return NextResponse.json({ error: "Still answering the last question. Wait or press Stop." }, { status: 409 });
  const db = getDb();
  const cwd = writeAssistantContext(db, getRegistry());
  return streamConversation(db, {
    threadId: THREAD,
    message,
    newConversation: Boolean(body?.new_conversation),
    run: ({ resumeSessionId, onChunk }) =>
      runClaude({
        key: KEY,
        cwd,
        message,
        permissionMode: "default",
        resumeSessionId,
        allowedTools: ["Read", "Glob", "Grep", "LS"],
        env: { AGENT_OPS_SKIP_HOOK: "1" },
        timeoutMs: 5 * 60_000,
        onChunk,
      }),
  });
}
