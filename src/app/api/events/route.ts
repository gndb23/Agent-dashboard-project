import { NextResponse } from "next/server";
import { handleIncomingEvents } from "@/lib/service";
import { getActivity } from "@/lib/queries";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Ingest one event or an array of events (contract: docs/EVENT_SCHEMA.md). */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const { touched: _t, ...result } = handleIncomingEvents(body);
  const status = result.accepted > 0 || result.duplicates > 0 ? 202 : 400;
  return NextResponse.json(result, { status });
}

/** Recent activity (handy for scripts / debugging). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 40);
  const agentId = url.searchParams.get("agent_id") ?? undefined;
  return NextResponse.json(getActivity(getDb(), { limit, agentId }));
}
