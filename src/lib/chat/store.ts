import { randomUUID } from "node:crypto";
import type { DB } from "../db/client";

export type ChatRow = {
  id: number;
  agentId: string;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  sessionId: string | null;
  status: "done" | "streaming" | "error" | "stopped";
  costUsd: number | null;
  createdAt: number;
};

function map(r: Record<string, unknown>): ChatRow {
  return {
    id: r.id as number,
    agentId: r.agent_id as string,
    conversationId: r.conversation_id as string,
    role: r.role as ChatRow["role"],
    text: r.text as string,
    tools: r.tools ? (JSON.parse(r.tools as string) as string[]) : [],
    sessionId: (r.session_id as string | null) ?? null,
    status: r.status as ChatRow["status"],
    costUsd: (r.cost_usd as number | null) ?? null,
    createdAt: r.created_at as number,
  };
}

/** The conversation currently shown for an agent (the most recent one). */
export function currentConversation(db: DB, agentId: string): { conversationId: string | null; sessionId: string | null } {
  const last = db.$client.prepare(`SELECT conversation_id FROM chat_messages WHERE agent_id = ? ORDER BY id DESC LIMIT 1`).get(agentId) as
    | { conversation_id: string }
    | undefined;
  if (!last) return { conversationId: null, sessionId: null };
  const sess = db.$client
    .prepare(`SELECT session_id FROM chat_messages WHERE conversation_id = ? AND session_id IS NOT NULL ORDER BY id DESC LIMIT 1`)
    .get(last.conversation_id) as { session_id: string } | undefined;
  return { conversationId: last.conversation_id, sessionId: sess?.session_id ?? null };
}

export function listMessages(db: DB, agentId: string, conversationId?: string | null, limit = 200): ChatRow[] {
  const conv = conversationId ?? currentConversation(db, agentId).conversationId;
  if (!conv) return [];
  return (db.$client.prepare(`SELECT * FROM chat_messages WHERE agent_id = ? AND conversation_id = ? ORDER BY id ASC LIMIT ?`).all(agentId, conv, limit) as Record<string, unknown>[]).map(map);
}

export function addMessage(
  db: DB,
  m: { agentId: string; conversationId: string; role: "user" | "assistant"; text: string; status: ChatRow["status"]; sessionId?: string | null },
  now = Date.now(),
): number {
  const r = db.$client
    .prepare(`INSERT INTO chat_messages (agent_id, conversation_id, role, text, session_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(m.agentId, m.conversationId, m.role, m.text, m.sessionId ?? null, m.status, now);
  return Number(r.lastInsertRowid);
}

export function updateMessage(db: DB, id: number, patch: { text: string; tools: string[]; status: ChatRow["status"]; sessionId?: string | null; costUsd?: number | null }) {
  db.$client
    .prepare(`UPDATE chat_messages SET text = ?, tools = ?, status = ?, session_id = COALESCE(?, session_id), cost_usd = COALESCE(?, cost_usd) WHERE id = ?`)
    .run(patch.text, JSON.stringify(patch.tools), patch.status, patch.sessionId ?? null, patch.costUsd ?? null, id);
}

/** Replies left "streaming" by a crashed/restarted server are marked stopped. */
export function closeOrphanedReplies(db: DB, agentId: string) {
  db.$client.prepare(`UPDATE chat_messages SET status = 'stopped' WHERE agent_id = ? AND status = 'streaming'`).run(agentId);
}

export const newConversationId = () => randomUUID();
