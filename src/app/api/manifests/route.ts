import { NextResponse } from "next/server";
import { createManifestFile, getRegistry } from "@/lib/registry/registry";
import { publish } from "@/lib/events/bus";
import { sweepAlerts } from "@/lib/service";

/** Create a starter manifest for an agent that is sending events but isn't registered yet. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { agent_id?: string; type?: string };
  const id = body.agent_id ?? "";
  const type = body.type === "api-script" || body.type === "other" ? body.type : "claude-code";
  try {
    const file = createManifestFile(id, type);
    getRegistry();
    sweepAlerts();
    publish({ kind: "registry" });
    return NextResponse.json({ ok: true, file }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function GET() {
  const { agents, errors } = getRegistry();
  return NextResponse.json({ agents, errors });
}
