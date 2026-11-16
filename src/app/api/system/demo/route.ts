import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { removeDemoData } from "@/lib/demo";
import { agentsDir } from "@/lib/registry/registry";
import { publish } from "@/lib/events/bus";
import { localOnlyError } from "@/lib/local-only";

export async function DELETE(req: Request) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const r = removeDemoData(getDb(), agentsDir());
  publish({ kind: "registry" });
  return NextResponse.json(r);
}
