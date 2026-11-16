import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRegistry, agentsDir, localTimeZone } from "@/lib/registry/registry";
import { registerAgent, scheduleToCron, slugify, type PermissionMode } from "@/lib/register";
import { patchManifestText, writeWithBackup } from "@/lib/manifest-edit";
import { publish } from "@/lib/events/bus";
import { sweepAlerts } from "@/lib/service";
import { localOnlyError } from "@/lib/local-only";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getRegistry().agents.map(({ origin, ...a }) => ({ ...a, origin: origin ? { ...origin, instructions: undefined } : undefined })));
}

type CreateBody = {
  name?: string; id?: string; description?: string; instructions?: string; projectDir?: string;
  schedule?: string; timezone?: string; triggers?: string[]; tags?: string[];
  permissionMode?: PermissionMode; runOnSchedule?: boolean; extraDirs?: string[];
};

/** Create an agent: manifest + working folder + CLAUDE.md with its instructions. */
export async function POST(req: Request) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as CreateBody;
  const name = b.name?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "Give the agent a name." }, { status: 400 });
  const id = (b.id?.trim() || slugify(name)).toLowerCase();
  if (!id) return NextResponse.json({ error: "The name needs at least one letter or number." }, { status: 400 });
  if (getRegistry().byId.has(id)) return NextResponse.json({ error: `An agent with the id "${id}" already exists. Pick another name.` }, { status: 409 });
  const sched = scheduleToCron(b.schedule ?? "");
  if ("error" in sched) return NextResponse.json({ error: sched.error }, { status: 400 });
  const projectDir = b.projectDir?.trim() ? path.resolve(b.projectDir.trim()) : path.join(os.homedir(), "agents", id);
  try {
    registerAgent(
      {
        id, name, description: b.description?.trim(), type: "claude-code", projectDir,
        schedule: sched.cron, scheduleLabel: sched.label, timezone: sched.cron ? b.timezone?.trim() || localTimeZone() : undefined,
        triggers: (b.triggers ?? []).filter(Boolean), tags: b.tags ?? [], permissionMode: b.permissionMode ?? "default",
        reportsRuns: true, instructions: b.instructions,
      },
      { agentsDir: agentsDir(), dashboardRoot: process.cwd(), hooks: "none" },
    );
    const file = path.join(agentsDir(), `${id}.yaml`);
    const extra = (b.extraDirs ?? []).map((d) => d.trim()).filter(Boolean);
    if (b.runOnSchedule || extra.length) {
      const text = patchManifestText(fs.readFileSync(file, "utf8"), id, {
        ...(b.runOnSchedule ? { run: { on_schedule: true } } : {}),
        ...(extra.length ? { extra_dirs: extra } : {}),
      });
      writeWithBackup(file, text);
      fs.rmSync(`${file}.bak`, { force: true });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  getRegistry();
  sweepAlerts();
  publish({ kind: "registry" });
  return NextResponse.json({ id, projectDir }, { status: 201 });
}
