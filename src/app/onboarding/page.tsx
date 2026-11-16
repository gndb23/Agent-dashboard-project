import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getRegistry } from "@/lib/registry/registry";
import { getAgentCards } from "@/lib/queries";
import { defaultManifestYaml } from "@/lib/registry/manifest";
import { claudeHookSettings } from "@/lib/hook-config";
import { timeAgo } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { CodeBlock } from "@/components/code-block";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateManifestButton } from "@/components/actions";
import { StatusDot } from "@/components/status";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="relative min-w-0 pl-11">
      <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border border-border-strong bg-surface text-[12px] font-semibold text-fg tabular">{n}</span>
      <h2 className="pt-1 text-[15px] font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 space-y-3 text-[13px] leading-relaxed text-fg-muted">{children}</div>
    </section>
  );
}

const code = (s: string) => <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-fg">{s}</code>;

export default function OnboardingPage() {
  const now = Date.now();
  const registry = getRegistry();
  const cards = getAgentCards(getDb(), registry, now);
  const unregistered = cards.filter((c) => !c.manifest);
  const recent = cards.filter((c) => c.lastRun).sort((a, b) => (b.lastRun?.lastEventAt ?? 0) - (a.lastRun?.lastEventAt ?? 0)).slice(0, 6);
  const hooks = JSON.stringify(claudeHookSettings(), null, 2);
  const curl = `curl -X POST http://localhost:4321/api/events \\
  -H 'content-type: application/json' \\
  -d '{
    "schema_version": 1,
    "agent_id": "my-new-agent",
    "run_id": "run-'$(date +%s)'",
    "event_type": "run_started",
    "payload": { "title": "Hello from my agent" }
  }'`;
  const python = `import json, time, urllib.request, uuid

AGENT_OPS = "http://localhost:4321/api/events"
RUN_ID = str(uuid.uuid4())

def report(event_type, status=None, payload=None, metrics=None):
    """Fire-and-forget: never let monitoring break the agent."""
    body = {"schema_version": 1, "agent_id": "my-new-agent", "run_id": RUN_ID,
            "event_type": event_type, "timestamp": time.time(),
            "status": status, "payload": payload or {}, "metrics": metrics}
    req = urllib.request.Request(AGENT_OPS, json.dumps(body).encode(),
                                 {"content-type": "application/json"})
    try: urllib.request.urlopen(req, timeout=1)
    except Exception: pass

report("run_started", payload={"title": "Nightly sync"})
report("tool_called", payload={"tool": "fetch_orders"})
report("run_completed", status="success", metrics={"tokens_in": 1200, "tokens_out": 300, "cost_usd": 0.01})`;

  return (
    <>
      <PageHeader title="Add an agent" description="Any agent can join in about five minutes: describe it in a manifest, then point its events at this dashboard." />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-10">
          <Step n={1} title="Describe the agent in a manifest">
            <p>
              Create {code("agents/<agent-id>.yaml")} in this project. The file name must match the {code("id")}. The dashboard picks it up instantly, no restart needed.
              For Claude Code agents, use the project folder name as the id (or set {code("AGENT_ID")} in step 2).
            </p>
            <CodeBlock title="agents/my-new-agent.yaml" code={defaultManifestYaml("my-new-agent")} />
            <p>
              Alert rule types: {code("consecutive_failures")} {code("failures_in_window")} {code("runtime_exceeds")} {code("no_run_within")} {code("cost_per_run_exceeds")}.
              Full reference in {code("docs/ONBOARDING.md")}.
            </p>
          </Step>

          <Step n={2} title="Claude Code agents: add the hooks">
            <p>
              Paste this into {code("<your-project>/.claude/settings.json")} (one project) or {code("~/.claude/settings.json")} (every project).
              Each session becomes a run; tool calls, prompts and token usage stream in live. The hook is fire-and-forget with a 1s timeout, so it never slows the agent down.
            </p>
            <CodeBlock title=".claude/settings.json" code={hooks} />
            <p>
              To pin a specific agent id, run {code("npm run hook-config -- my-new-agent")} and paste its output instead.
              To backfill past sessions, run {code("npm run import:transcripts")}.
            </p>
            <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px]">
              <strong className="text-fg">Cloud sessions</strong> (claude.ai/code) run in a remote container and can&apos;t reach {code("localhost")}. Expose the dashboard with a tunnel
              and set {code("AGENT_OPS_URL")}, or host the dashboard. See the README.
            </p>
          </Step>

          <Step n={3} title="Any other agent: POST events">
            <p>
              Send JSON to {code("POST /api/events")} (one event or an array). Only {code("schema_version")}, {code("agent_id")}, {code("run_id")} and {code("event_type")} are required.
              Contract: {code("docs/EVENT_SCHEMA.md")}.
            </p>
            <CodeBlock title="shell" code={curl} />
            <CodeBlock title="python (no dependencies)" code={python} />
          </Step>

          <Step n={4} title="Check that it's connected">
            <p>
              Run your agent once. It appears in the panel on the right within a second. If it says <em>Unregistered</em>, the agent id in the events
              doesn&apos;t match a manifest, so click <em>Create manifest</em> to register it.
            </p>
          </Step>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Listening for events</CardTitle>
              <span className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
                <span className="h-1.5 w-1.5 rounded-full bg-status-running animate-pulse-dot" /> live
              </span>
            </CardHeader>
            <ul className="divide-y divide-border">
              {recent.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-fg-subtle">Waiting for the first event…</li>}
              {recent.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                  <StatusDot status={c.status} />
                  <Link href={`/agents/${encodeURIComponent(c.id)}`} className="truncate text-fg hover:text-accent">{c.name}</Link>
                  <span className="ml-auto shrink-0 text-[12px] text-fg-subtle tabular">{timeAgo(c.lastRun?.lastEventAt, now)}</span>
                </li>
              ))}
            </ul>
          </Card>

          {unregistered.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Unregistered agents</CardTitle>
                <Badge variant="outline">{unregistered.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {unregistered.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                    <code className="font-mono text-[12px] text-fg">{c.id}</code>
                    <CreateManifestButton agentId={c.id} type={c.lastSource === "claude-code-hook" ? "claude-code" : "other"} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {registry.errors.length > 0 && (
            <Card className="border-status-warning/40">
              <CardHeader>
                <CardTitle className="text-status-warning">Manifest errors</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {registry.errors.map((e) => (
                  <div key={e.file}>
                    <code className="font-mono text-[12px] text-fg">agents/{e.file}</code>
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-fg-muted">{e.error}</pre>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
