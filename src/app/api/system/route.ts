import { NextResponse } from "next/server";
import { runChecks, gitInfo } from "@/lib/system/doctor";
import { discoverTasks } from "@/lib/claude-tasks/discover";
import { readSettings } from "@/lib/settings";
import { hasDemoData } from "@/lib/demo";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Health checks and system info for the Settings page. */
export async function GET() {
  const [checks] = await Promise.all([runChecks()]);
  return NextResponse.json({
    checks,
    git: gitInfo(),
    supervised: process.env.AGENT_OPS_SUPERVISED === "1",
    settings: readSettings(),
    tasks: discoverTasks().report,
    demo: hasDemoData(getDb()),
    platform: process.platform,
  });
}
