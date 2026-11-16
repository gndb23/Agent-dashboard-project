import { NextResponse } from "next/server";
import path from "node:path";
import { readSettings, writeSettings } from "@/lib/settings";
import { resetDiscovery } from "@/lib/claude-tasks/discover";
import { publish } from "@/lib/events/bus";
import { localOnlyError } from "@/lib/local-only";

export async function GET() {
  return NextResponse.json(readSettings());
}

export async function PATCH(req: Request) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (Array.isArray(body.taskDirs)) {
    const dirs = body.taskDirs.filter((d): d is string => typeof d === "string" && d.trim() !== "").map((d) => d.trim());
    const bad = dirs.filter((d) => !path.isAbsolute(d));
    if (bad.length) return NextResponse.json({ error: `Use full paths (not ${bad.join(", ")})` }, { status: 400 });
    patch.taskDirs = dirs;
  }
  if (typeof body.claudeAppDir === "string") patch.claudeAppDir = body.claudeAppDir.trim() || undefined;
  if (typeof body.autoImportHistory === "boolean") patch.autoImportHistory = body.autoImportHistory;
  if (typeof body.notifications === "boolean") patch.notifications = body.notifications;
  const s = writeSettings(patch);
  resetDiscovery();
  publish({ kind: "registry" });
  return NextResponse.json(s);
}
