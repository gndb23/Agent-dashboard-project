import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { setAlertStatus } from "@/lib/alerts/engine";
import { publish } from "@/lib/events/bus";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { status?: string };
  if (body.status !== "acknowledged" && body.status !== "resolved") {
    return NextResponse.json({ error: 'status must be "acknowledged" or "resolved"' }, { status: 400 });
  }
  const ok = setAlertStatus(getDb(), Number(id), body.status);
  if (!ok) return NextResponse.json({ error: "Alert not found or already resolved" }, { status: 404 });
  publish({ kind: "alert", agentId: "", status: body.status });
  return NextResponse.json({ ok: true });
}
