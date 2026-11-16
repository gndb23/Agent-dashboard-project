import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getRegistry } from "@/lib/registry/registry";
import { resetDiscovery } from "@/lib/claude-tasks/discover";
import { publish } from "@/lib/events/bus";
import { localOnlyError } from "@/lib/local-only";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Where an agent's instructions live: the Claude task's SKILL.md, or CLAUDE.md in its folder. */
function instructionsFile(id: string): { file: string | null; kind: "skill" | "claude-md" | null; frontMatter: string } {
  const m = getRegistry().byId.get(id);
  if (!m) return { file: null, kind: null, frontMatter: "" };
  if (m.origin) {
    const text = fs.existsSync(m.origin.skillFile) ? fs.readFileSync(m.origin.skillFile, "utf8") : "";
    const fm = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)?.[0] ?? "";
    return { file: m.origin.skillFile, kind: "skill", frontMatter: fm };
  }
  if (m.project_dir) return { file: path.join(m.project_dir, "CLAUDE.md"), kind: "claude-md", frontMatter: "" };
  return { file: null, kind: null, frontMatter: "" };
}

export async function GET(req: Request, ctx: Ctx) {
  const id = decodeURIComponent((await ctx.params).id);
  const { file, kind, frontMatter } = instructionsFile(id);
  if (!file) return NextResponse.json({ file: null, kind: null, text: "" });
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return NextResponse.json({ file, kind, text: kind === "skill" ? raw.slice(frontMatter.length).replace(/^\s+/, "") : raw });
}

export async function PUT(req: Request, ctx: Ctx) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const id = decodeURIComponent((await ctx.params).id);
  const { file, kind, frontMatter } = instructionsFile(id);
  if (!file) return NextResponse.json({ error: "Set a working folder for this agent first (Settings tab)." }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  if (typeof body.text !== "string") return NextResponse.json({ error: "text is required" }, { status: 400 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.writeFileSync(`${file}.bak`, fs.readFileSync(file));
  fs.writeFileSync(file, kind === "skill" ? `${frontMatter}\n${body.text.trim()}\n` : body.text);
  resetDiscovery();
  publish({ kind: "registry" });
  return NextResponse.json({ ok: true, file });
}
