"use client";

import { useRef } from "react";
import { FolderOpen, MessageSquarePlus } from "lucide-react";
import { Button } from "./ui/button";
import { ConversationView } from "./conversation-view";
import { Composer } from "./composer";
import { useConversation, type Msg } from "./use-conversation";

const MODE_NOTE: Record<string, string> = {
  default: "It can read and search files to answer you. It can't change anything.",
  plan: "Plan mode: it can explore and propose, but not change anything.",
  acceptEdits: "It can read and edit files in its folders.",
};

/** Chat with one agent: Claude Code runs in the agent's folder, with its instructions and readable folders. */
export function ChatPanel({
  agentId, agentName, enabled, disabledReason, permissionMode, projectDir, readableDirs = [], initialMessages,
}: {
  agentId: string; agentName: string; enabled: boolean; disabledReason?: string; permissionMode?: string; projectDir?: string; readableDirs?: string[]; initialMessages: Msg[];
}) {
  const conv = useConversation(`/api/agents/${encodeURIComponent(agentId)}/chat`, initialMessages);
  const box = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="flex h-[600px] flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Chat with {agentName}</h2>
          {enabled && projectDir && (
            <div className="flex items-center gap-1 truncate font-mono text-2xs text-fg-subtle" title={[projectDir, ...readableDirs].join("\n")}>
              <FolderOpen size={11} className="shrink-0" /> {projectDir}
              {readableDirs.length > 0 && <span className="shrink-0"> +{readableDirs.length}</span>}
            </div>
          )}
        </div>
        {enabled && (
          <Button size="sm" variant="ghost" onClick={() => (conv.startFresh(), box.current?.focus())} disabled={conv.busy} title="Start a new conversation">
            <MessageSquarePlus size={13} /> New
          </Button>
        )}
      </div>
      {enabled ? (
        <ConversationView
          messages={conv.messages}
          empty={
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="text-sm font-medium text-fg">Ask {agentName} anything</div>
              <p className="mt-1.5 max-w-xs text-sm text-fg-muted">
                It knows its instructions and can look at the files in its folders. {MODE_NOTE[permissionMode ?? "default"]}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {["What do you do?", "What files can you see?", "What happened in your last run?"].map((q) => (
                  <button key={q} onClick={() => conv.send(q)} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg cursor-pointer">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          }
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="text-sm font-medium text-fg">Chat isn&apos;t available for this agent</div>
          <p className="mt-1.5 max-w-xs text-sm text-fg-muted">{disabledReason}</p>
          <a href={`/agents/${encodeURIComponent(agentId)}/settings`} className="mt-3 text-sm text-accent hover:underline">Open Settings</a>
        </div>
      )}
      <Composer ref={box} busy={conv.busy} disabled={!enabled} placeholder={enabled ? `Message ${agentName}…` : "Chat is not available"} onSend={conv.send} onStop={conv.stop} />
    </div>
  );
}
