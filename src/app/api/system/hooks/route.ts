import { NextResponse } from "next/server";
import { installGlobalHooks } from "@/lib/system/hooks";
import { localOnlyError } from "@/lib/local-only";

export async function POST(req: Request) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  try {
    return NextResponse.json(installGlobalHooks(process.cwd()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
