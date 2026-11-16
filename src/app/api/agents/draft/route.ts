import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { runClaude } from "@/lib/claude/run";
import { assistantDir } from "@/lib/assistant/context";
import { localOnlyError } from "@/lib/local-only";

export const dynamic = "force-dynamic";

const PROMPT = (description: string) => `Design an AI agent from this description. Reply with ONLY a JSON object, no other text:
{"name": "...", "description": "one line", "schedule": "e.g. daily 07:30 | weekdays 08:00 | every 2h | 5-field cron | empty for on demand", "instructions": "clear step-by-step instructions in Markdown the agent can follow alone: goal, inputs, steps, output location, what to do on errors", "tags": ["..."]}

Description:
${description}`;

/** Turns a plain-language description into a filled-in agent form. */
export async function POST(req: Request) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { description?: string };
  const description = body.description?.trim() ?? "";
  if (description.length < 8) return NextResponse.json({ error: "Describe what the agent should do in a sentence or two." }, { status: 400 });
  const cwd = path.join(assistantDir(), "drafts");
  fs.mkdirSync(cwd, { recursive: true });
  let text = "";
  let error = "";
  const status = await runClaude({
    key: `draft:${Date.now()}`,
    cwd,
    message: PROMPT(description.slice(0, 8000)),
    permissionMode: "default",
    allowedTools: [],
    env: { AGENT_OPS_SKIP_HOOK: "1" },
    timeoutMs: 3 * 60_000,
    onChunk: (c) => {
      if (c.type === "text") text += c.text;
      if (c.type === "error") error = c.message;
    },
  });
  if (status !== "done") return NextResponse.json({ error: error || "Couldn't draft the agent." }, { status: 502 });
  const m = text.match(/\{[\s\S]*\}/);
  try {
    const draft = JSON.parse(m ? m[0] : text);
    return NextResponse.json({ draft });
  } catch {
    return NextResponse.json({ error: "The draft came back in an unexpected format. Try again or fill in the form yourself." }, { status: 502 });
  }
}
