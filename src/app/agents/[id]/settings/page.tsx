import type { Metadata } from "next";
import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { getRegistry, agentsDir } from "@/lib/registry/registry";
import { PageHeader } from "@/components/page-header";
import { AgentSettings } from "@/components/agent-settings";

export const metadata: Metadata = { title: "Agent settings" };

export default async function AgentSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const reg = getRegistry();
  const m = reg.byId.get(id);
  if (!m) notFound();
  let file: string | null = null;
  let text = "";
  if (m.origin) {
    file = m.origin.skillFile;
    const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    text = raw.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").replace(/^\s+/, "");
  } else if (m.project_dir) {
    file = path.join(m.project_dir, "CLAUDE.md");
    text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  }
  const { origin, ...plain } = m;
  return (
    <>
      <PageHeader
        eyebrow={<span><Link href="/agents" className="hover:text-fg">Agents</Link> / <Link href={`/agents/${encodeURIComponent(id)}`} className="hover:text-fg">{m.name}</Link></span>}
        title="Settings"
        description={origin ? "This agent is a Claude scheduled task. Its schedule comes from the Claude app; everything else can be set here." : "Changes apply right away."}
      />
      <AgentSettings
        agent={{ ...plain, origin: origin ? { ...origin } : undefined }}
        allAgents={reg.agents.map((a) => ({ id: a.id, name: a.name }))}
        instructions={text}
        instructionsFile={file}
        hasFile={fs.existsSync(path.join(agentsDir(), `${id}.yaml`))}
      />
    </>
  );
}
