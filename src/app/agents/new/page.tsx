import type { Metadata } from "next";
import os from "node:os";
import path from "node:path";
import { getRegistry, localTimeZone } from "@/lib/registry/registry";
import { PageHeader } from "@/components/page-header";
import { AgentWizard } from "@/components/agent-wizard";

export const metadata: Metadata = { title: "New agent" };

function readDraft(s?: string) {
  if (!s) return undefined;
  try {
    const d = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    return {
      name: typeof d.name === "string" ? d.name : undefined,
      description: typeof d.description === "string" ? d.description : undefined,
      instructions: typeof d.instructions === "string" ? d.instructions : undefined,
      schedule: typeof d.schedule === "string" ? d.schedule : undefined,
      tags: Array.isArray(d.tags) ? d.tags.filter((t: unknown) => typeof t === "string") : undefined,
    };
  } catch {
    return undefined;
  }
}

export default async function NewAgentPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const { draft } = await searchParams;
  const agents = getRegistry().agents.map((a) => ({ id: a.id, name: a.name }));
  return (
    <>
      <PageHeader title="New agent" description="Five quick steps. Everything can be changed later in the agent's Settings." />
      <AgentWizard initial={readDraft(draft)} agents={agents} homeAgentsDir={path.join(os.homedir(), "agents")} localTz={localTimeZone()} />
    </>
  );
}
