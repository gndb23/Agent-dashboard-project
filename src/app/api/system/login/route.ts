import { NextResponse } from "next/server";
import { spawn, type ChildProcess } from "node:child_process";
import { resolveClaude } from "@/lib/claude/run";
import { claudeAuthStatus } from "@/lib/system/doctor";
import { localOnlyError } from "@/lib/local-only";

export const dynamic = "force-dynamic";

type Login = { child: ChildProcess; output: string; startedAt: number; exited: boolean; code: number | null };
const g = globalThis as unknown as { __agentOpsLogin?: Login };

const urlsIn = (s: string) => [...new Set(s.match(/https:\/\/[^\s"'<>]+/g) ?? [])];

export async function GET() {
  const l = g.__agentOpsLogin;
  const status = await claudeAuthStatus();
  return NextResponse.json({
    status,
    login: l ? { running: !l.exited, urls: urlsIn(l.output), output: l.output.slice(-2000), code: l.code } : null,
  });
}

/** Starts `claude auth login` (opens the sign-in page), or sends a pasted code to it. */
export async function POST(req: Request) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const l = g.__agentOpsLogin;
  if (body.code) {
    if (!l || l.exited) return NextResponse.json({ error: "No sign-in is waiting for a code. Start again." }, { status: 409 });
    l.child.stdin?.write(body.code.trim() + "\n");
    return NextResponse.json({ ok: true });
  }
  if (l && !l.exited) return NextResponse.json({ ok: true, urls: urlsIn(l.output) });
  const bin = resolveClaude();
  if (!bin) return NextResponse.json({ error: "Claude Code isn't installed on this computer." }, { status: 409 });
  const child = spawn(bin.command, [...bin.prefixArgs, "auth", "login"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const entry: Login = { child, output: "", startedAt: Date.now(), exited: false, code: null };
  g.__agentOpsLogin = entry;
  const onData = (d: Buffer) => (entry.output = (entry.output + d.toString()).slice(-8000));
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("close", (code) => {
    entry.exited = true;
    entry.code = code;
  });
  child.on("error", (e) => {
    entry.exited = true;
    entry.output += `\n${e.message}`;
  });
  setTimeout(() => !entry.exited && child.kill(), 10 * 60_000).unref();
  await new Promise((r) => setTimeout(r, 1500));
  return NextResponse.json({ ok: true, urls: urlsIn(entry.output) });
}
