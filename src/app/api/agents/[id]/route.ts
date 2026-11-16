import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getRegistry, agentsDir } from "@/lib/registry/registry";
import { archiveManifest, manifestFromAgent, patchManifestText, writeWithBackup, type ManifestPatch } from "@/lib/manifest-edit";
import { scheduleToCron } from "@/lib/register";
import { publish } from "@/lib/events/bus";
import { sweepAlerts } from "@/lib/service";
import { localOnlyError } from "@/lib/local-only";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Update an agent's settings (comments in the YAML are kept). Task agents get a settings file on first save. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const id = decodeURIComponent((await ctx.params).id);
  const m = getRegistry().byId.get(id);
  if (!m) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as ManifestPatch & { scheduleText?: string };
  const patch: ManifestPatch = { ...body };
  delete (patch as { scheduleText?: string }).scheduleText;
  if (typeof body.scheduleText === "string") {
    if (m.origin && m.origin.cronSource === "app") {
      return NextResponse.json({ error: "This agent's schedule comes from the Claude app. Change it there (Scheduled → the task → Edit)." }, { status: 409 });
    }
    const s = scheduleToCron(body.scheduleText);
    if ("error" in s) return NextResponse.json({ error: s.error }, { status: 400 });
    patch.schedule = s.cron;
    if (!s.cron) patch.timezone = null;
  }
  for (const k of ["project_dir"] as const) {
    const v = patch[k];
    if (typeof v === "string" && v.trim() && !path.isAbsolute(v.trim())) return NextResponse.json({ error: "Folders must be full paths, e.g. C:\\Users\\you\\agents\\my-agent" }, { status: 400 });
    if (typeof v === "string") patch[k] = v.trim() ? v.trim().replace(/\\/g, "/") : null;
  }
  if (patch.extra_dirs) patch.extra_dirs = patch.extra_dirs.map((d) => d.trim().replace(/\\/g, "/")).filter(Boolean);
  const file = path.join(agentsDir(), `${id}.yaml`);
  try {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : manifestFromAgent(m);
    writeWithBackup(file, patchManifestText(current, id, patch));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  getRegistry();
  sweepAlerts();
  publish({ kind: "registry" });
  return NextResponse.json({ ok: true });
}

/** Archive an agent (moves its file to agents/_archived/). Run history is kept. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const id = decodeURIComponent((await ctx.params).id);
  const m = getRegistry().byId.get(id);
  if (m?.origin?.virtual) {
    return NextResponse.json({ error: "This agent is a Claude scheduled task. Delete or pause it in the Claude app; it disappears here automatically." }, { status: 409 });
  }
  try {
    const to = archiveManifest(agentsDir(), id);
    getRegistry();
    sweepAlerts();
    publish({ kind: "registry" });
    return NextResponse.json({ archivedTo: to });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
