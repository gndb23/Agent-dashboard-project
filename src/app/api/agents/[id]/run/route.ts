import { NextResponse } from "next/server";
import { getRegistry } from "@/lib/registry/registry";
import { isAgentRunning, startAgentRun, stopAgentRun } from "@/lib/runner/run-agent";
import { localOnlyError } from "@/lib/local-only";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return NextResponse.json({ running: isAgentRunning(decodeURIComponent(id)) });
}

/** Run the agent now (in the background). The run appears live on the dashboard. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const { id } = await ctx.params;
  const m = getRegistry().byId.get(decodeURIComponent(id));
  if (!m) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
  const r = startAgentRun(m, "manual");
  return "error" in r ? NextResponse.json(r, { status: 409 }) : NextResponse.json(r, { status: 202 });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const { id } = await ctx.params;
  return NextResponse.json({ stopped: stopAgentRun(decodeURIComponent(id)) });
}
