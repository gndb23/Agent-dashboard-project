import { describe, it, expect, beforeAll } from "vitest";
import os from "node:os";
import path from "node:path";
import { chatAvailability, parseStreamLine, runChatTurn, stopChat, isChatRunning, type ChatChunk } from "@/lib/chat/runner";
import { addMessage, closeOrphanedReplies, currentConversation, listMessages, updateMessage } from "@/lib/chat/store";
import { createDb } from "@/lib/db/client";
import { localOnlyError } from "@/lib/local-only";
import { parseManifest } from "@/lib/registry/manifest";

const FAKE = path.resolve(__dirname, "fixtures/fake-claude.mjs");
beforeAll(() => {
  process.env.AGENT_OPS_CLAUDE_BIN = FAKE;
});

async function turn(message: string, extra: Partial<Parameters<typeof runChatTurn>[0]> = {}) {
  const chunks: ChatChunk[] = [];
  const status = await runChatTurn({ agentId: "a1", projectDir: os.tmpdir(), permissionMode: "default", message, onChunk: (c) => chunks.push(c), ...extra });
  const text = chunks.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
  return { status, chunks, text };
}

describe("parseStreamLine", () => {
  it("extracts session, text deltas, tools and the result", () => {
    const st = { sawDeltas: false };
    expect(parseStreamLine('{"type":"system","subtype":"init","session_id":"s1"}', st)).toEqual([{ type: "session", sessionId: "s1" }]);
    expect(parseStreamLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}', st)).toEqual([{ type: "text", text: "Hi" }]);
    const a = parseStreamLine('{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"},{"type":"tool_use","name":"Bash","input":{"command":"ls -la"}}]}}', st);
    expect(a).toEqual([expect.objectContaining({ type: "tool", name: "Bash", summary: "ls -la" })]); // text skipped: already streamed
    const r = parseStreamLine('{"type":"result","subtype":"error_max_turns","session_id":"s1","total_cost_usd":0.5}', st);
    expect(r[0]).toMatchObject({ type: "result", isError: true, costUsd: 0.5 });
  });

  it("falls back to whole assistant messages when no deltas are streamed, and ignores junk", () => {
    const st = { sawDeltas: false };
    expect(parseStreamLine('{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}', st)).toEqual([{ type: "text", text: "Hello\n\n" }]);
    expect(parseStreamLine("not json", st)).toEqual([]);
    expect(parseStreamLine('{"type":"mystery"}', st)).toEqual([]);
    expect(parseStreamLine('{"type":"assistant","parent_tool_use_id":"x","message":{"content":[{"type":"text","text":"sub"}]}}', st)).toEqual([]);
  });
});

describe("runChatTurn (fake CLI)", () => {
  it("streams a reply, runs in the project dir, tags the agent and sends the message on stdin", async () => {
    const r = await turn('hello "; rm -rf / #');
    expect(r.status).toBe("done");
    expect(r.text).toContain('You said: hello "; rm -rf / #');
    expect(r.text).toContain(`cwd=${os.tmpdir()}`);
    expect(r.text).toContain("agent=a1");
    expect(r.text).toContain("mode=default");
    expect(r.text).toContain("resumed=no");
    expect(r.chunks).toContainEqual({ type: "session", sessionId: "sess-fake-1" });
    expect(r.chunks).toContainEqual(expect.objectContaining({ type: "tool", name: "Read", summary: "README.md" }));
    expect(r.chunks.at(-1)).toEqual({ type: "done", status: "done" });
    expect(isChatRunning("a1")).toBe(false);
  });

  it("resumes a session and passes the permission mode", async () => {
    const r = await turn("again", { resumeSessionId: "sess-abc", permissionMode: "acceptEdits" });
    expect(r.text).toContain("resumed=sess-abc");
    expect(r.text).toContain("mode=acceptEdits");
  });

  it("reports CLI failures, a missing CLI and a missing project folder", async () => {
    const failed = await turn("please FAIL");
    expect(failed.status).toBe("error");
    expect(failed.chunks).toContainEqual({ type: "error", message: "fake: something broke" });

    const noDir = await turn("hi", { projectDir: "/definitely/not/here" });
    expect(noDir.chunks[0]).toMatchObject({ type: "error", message: expect.stringContaining("Working folder does not exist") });

    process.env.AGENT_OPS_CLAUDE_BIN = "/no/such/claude-binary";
    const noBin = await turn("hi");
    process.env.AGENT_OPS_CLAUDE_BIN = FAKE;
    expect(noBin.status).toBe("error");
    expect(noBin.chunks[0]).toMatchObject({ type: "error", message: expect.stringContaining("not found") });
  });

  it("shows a logged-out error once, not twice", async () => {
    const r = await turn("NOLOGIN");
    expect(r.status).toBe("error");
    expect(r.text.match(/Not logged in/g)).toHaveLength(1);
    expect(r.chunks.filter((c) => c.type === "error")).toHaveLength(0);
  });

  it("allows one chat per agent at a time and can be stopped", async () => {
    const chunks: ChatChunk[] = [];
    const slow = runChatTurn({ agentId: "busy", projectDir: os.tmpdir(), permissionMode: "default", message: "SLOW", onChunk: (c) => chunks.push(c) });
    await new Promise((r) => setTimeout(r, 400));
    expect(isChatRunning("busy")).toBe(true);
    const second = await turn("hi", { agentId: "busy" });
    expect(second.chunks[0]).toMatchObject({ type: "error", message: expect.stringContaining("already busy") });
    expect(stopChat("busy")).toBe(true);
    expect(await slow).toBe("stopped");
    expect(isChatRunning("busy")).toBe(false);
    expect(stopChat("busy")).toBe(false);
  });
});

describe("chat availability + store + guard", () => {
  const m = (extra: string) => {
    const r = parseManifest(`id: a\nname: A\n${extra}`);
    if (!r.ok) throw new Error(r.error);
    return r.manifest;
  };

  it("is enabled only for claude-code agents with a project_dir", () => {
    expect(chatAvailability(null).enabled).toBe(false);
    expect(chatAvailability(m("type: api-script\nproject_dir: /tmp")).enabled).toBe(false);
    expect(chatAvailability(m("")).enabled).toBe(false);
    expect(chatAvailability(m("project_dir: /tmp"))).toMatchObject({ enabled: true, projectDir: "/tmp", permissionMode: "default", addDirs: [] });
    expect(chatAvailability(m("project_dir: /tmp\nextra_dirs: [/data/stock]"))).toMatchObject({ addDirs: ["/data/stock"] });
    expect(chatAvailability(m("project_dir: /tmp\nchat:\n  permission_mode: acceptEdits"))).toMatchObject({ permissionMode: "acceptEdits" });
    expect(parseManifest("id: a\nname: A\nproject_dir: relative/path").ok).toBe(false);
    expect(parseManifest("id: a\nname: A\nchat:\n  permission_mode: bypassPermissions").ok).toBe(false);
  });

  it("stores conversations and resumes the latest session", () => {
    const db = createDb(":memory:");
    expect(currentConversation(db, "a")).toEqual({ conversationId: null, sessionId: null });
    addMessage(db, { agentId: "a", conversationId: "c1", role: "user", text: "hi", status: "done" });
    const id = addMessage(db, { agentId: "a", conversationId: "c1", role: "assistant", text: "", status: "streaming" });
    closeOrphanedReplies(db, "a");
    expect(listMessages(db, "a")[1].status).toBe("stopped");
    updateMessage(db, id, { text: "hello", tools: ["Read · x"], status: "done", sessionId: "s1", costUsd: 0.01 });
    expect(currentConversation(db, "a")).toEqual({ conversationId: "c1", sessionId: "s1" });
    addMessage(db, { agentId: "a", conversationId: "c2", role: "user", text: "fresh", status: "done" });
    expect(currentConversation(db, "a")).toEqual({ conversationId: "c2", sessionId: null });
    expect(listMessages(db, "a").map((x) => x.text)).toEqual(["fresh"]);
    expect(listMessages(db, "a", "c1")[1]).toMatchObject({ text: "hello", tools: ["Read · x"], costUsd: 0.01 });
  });

  it("only accepts same-origin localhost requests", () => {
    const req = (h: Record<string, string>) => new Request("http://x/api", { headers: h });
    expect(localOnlyError(req({ host: "localhost:4321" }))).toBeNull();
    expect(localOnlyError(req({ host: "127.0.0.1:4321", origin: "http://127.0.0.1:4321", "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(localOnlyError(req({ host: "192.168.1.20:4321" }))).toMatch(/localhost/);
    expect(localOnlyError(req({ host: "evil.example.com" }))).toMatch(/localhost/);
    expect(localOnlyError(req({ host: "localhost:4321", origin: "https://evil.example.com" }))).toMatch(/Cross-origin/);
    expect(localOnlyError(req({ host: "localhost:4321", origin: "http://localhost:9999" }))).toMatch(/Cross-origin/);
    expect(localOnlyError(req({ host: "localhost:4321", "sec-fetch-site": "cross-site" }))).toMatch(/Cross-site/);
  });
});
