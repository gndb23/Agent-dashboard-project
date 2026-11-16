import { NextResponse } from "next/server";
import { discoverTasks } from "@/lib/claude-tasks/discover";
import { syncHistory } from "@/lib/service";
import { getRegistry } from "@/lib/registry/registry";
import { publish } from "@/lib/events/bus";
import { localOnlyError } from "@/lib/local-only";

/** Re-scan Claude scheduled tasks and import new session history now. */
export async function POST(req: Request) {
  const denied = localOnlyError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const { tasks, report } = discoverTasks({ force: true });
  getRegistry();
  const history = syncHistory({ force: true });
  publish({ kind: "registry" });
  return NextResponse.json({ tasks: tasks.length, report, history });
}
