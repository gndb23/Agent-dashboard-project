import { NextResponse } from "next/server";
import { updateAvailable } from "@/lib/system/doctor";
import { localOnlyError } from "@/lib/local-only";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await updateAvailable());
}

/** Restart into the updater: the supervisor pulls the latest version, rebuilds and restarts. */
export async function POST(req: Request) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  if (process.env.AGENT_OPS_SUPERVISED !== "1") {
    return NextResponse.json({ error: "Updating from the browser needs the Agent Ops launcher (the desktop shortcut). This copy was started by hand." }, { status: 409 });
  }
  setTimeout(() => process.exit(75), 400);
  return NextResponse.json({ ok: true, message: "Updating… the page will come back in a minute or two." }, { status: 202 });
}
