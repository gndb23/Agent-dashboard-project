import { notFound } from "next/navigation";
import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db/client";
import { getRegistry } from "@/lib/registry/registry";
import { getActivity, getAgentCards, getAgentDaily, getAgentRuns, listAlerts } from "@/lib/queries";
import { nextScheduledRun, ruleKey } from "@/lib/registry/manifest";
import { dateTime, duration, pct, timeAgo, usd } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Kpi } from "@/components/kpi";
import { AgentCharts } from "@/components/charts";
import { RunsTable } from "@/components/runs-table";
import { ActivityFeed } from "@/components/activity-feed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusDot, STATUS_LABEL } from "@/components/status";
import { CreateManifestButton } from "@/components/actions";
import { ChatPanel } from "@/components/chat-panel";
import { RunAgentButton } from "@/components/agent-actions";
import { AskAboutButton } from "@/components/assistant";
import { CalendarCheck, FolderOpen, Settings2 } from "lucide-react";
import { chatAvailability, isChatRunning } from "@/lib/chat/runner";
import { closeOrphanedReplies, listMessages } from "@/lib/chat/store";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const db = getDb();
  const registry = getRegistry();
  const now = Date.now();
  const card = getAgentCards(db, registry, now).find((c) => c.id === id);
  if (!card) notFound();

  const m = card.manifest;
  const runs = getAgentRuns(db, id, now, 100);
  const daily = getAgentDaily(db, id, 14, now);
  const activity = getActivity(db, { agentId: id, limit: 12 });
  const alerts = listAlerts(db).filter((a) => a.agentId === id && a.status !== "resolved");
  const finished = runs.filter((r) => r.durationMs != null);
  const avgDur = finished.length ? finished.reduce((s, r) => s + (r.durationMs ?? 0), 0) / finished.length : null;
  const totalCost = runs.reduce((s, r) => s + r.costUsd, 0);
  const chat = chatAvailability(m);
  if (!isChatRunning(id)) closeOrphanedReplies(db, id);
  const chatMessages = listMessages(db, id);
  let yaml = "";
  if (m) {
    try {
      yaml = fs.readFileSync(path.join(registry.dir, `${m.id}.yaml`), "utf8");
    } catch {
      yaml = "";
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/agents" className="hover:text-fg">Agents</Link>}
        title={
          <span className="flex items-center gap-2.5">
            <StatusDot status={card.status} className="h-2.5 w-2.5" />
            {card.name}
          </span>
        }
        description={m?.description || (m ? id : "This agent is sending events but has no manifest yet.")}
        actions={
          m ? (
            <div className="flex flex-wrap items-center gap-2">
              <AskAboutButton question={`How is the agent "${card.name}" (${id}) doing? Summarise its recent runs, any failures and their causes, and its cost.`} />
              <Link href={`/agents/${encodeURIComponent(id)}/settings`} className="inline-flex h-7 items-center gap-1.5 rounded-control border border-border-strong bg-surface px-2.5 text-xs font-medium text-fg hover:bg-surface-hover">
                <Settings2 size={13} /> Settings
              </Link>
              {m.type === "claude-code" && <RunAgentButton agentId={id} />}
            </div>
          ) : (
            <CreateManifestButton agentId={id} />
          )
        }
      />

      {m && (
        <div className="-mt-4 mb-6 flex flex-wrap items-center gap-1.5">
          {m.origin ? (
            <Badge variant="accent" title={m.origin.skillFile}>
              <CalendarCheck size={11} /> Claude scheduled task{m.origin.enabled === false ? " · paused in Claude" : ""}
            </Badge>
          ) : (
            <Badge>{m.type}</Badge>
          )}
          {m.origin?.model && <Badge variant="outline">model: {m.origin.model}</Badge>}
          {m.tags.filter((t) => t !== "claude-task").map((t) => (
            <Badge key={t} variant="outline">{t}</Badge>
          ))}
          {(m.project_dir ?? m.origin?.taskDir) && (
            <span className="ml-1 inline-flex items-center gap-1 truncate font-mono text-2xs text-fg-subtle" title="Working folder">
              <FolderOpen size={11} /> {m.project_dir ?? m.origin?.taskDir}
            </span>
          )}
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Status" value={STATUS_LABEL[card.status]} tone={card.status === "failed" ? "failed" : card.status === "warning" ? "warning" : card.status === "running" ? "running" : undefined} />
        <Kpi label="Last run" value={timeAgo(card.lastRun?.startedAt, now)} hint={card.lastRun ? dateTime(card.lastRun.startedAt) : undefined} />
        <Kpi label="Next run" value={card.nextRunAt ? timeAgo(card.nextRunAt, now) : "—"} hint={m?.schedule ? <code className="font-mono">{m.schedule}{m.timezone ? ` (${m.timezone})` : ""}</code> : "on demand"} />
        <Kpi label="Success 7d" value={pct(card.successRate7d)} />
        <Kpi label="Avg duration" value={duration(avgDur)} hint={m?.expected_runtime_minutes ? `expected ~${m.expected_runtime_minutes}m` : `last ${finished.length} runs`} />
        <Kpi label="Est. cost" value={usd(totalCost)} hint={`last ${runs.length} runs`} />
      </section>

      {alerts.length > 0 && (
        <div className="mt-4 space-y-2">
          {alerts.map((a) => (
            <Link key={a.id} href="/alerts" className="flex items-center gap-2 rounded-card border border-status-failed/35 bg-status-failed/8 px-4 py-2.5 text-sm hover:bg-status-failed/12">
              <Badge variant={a.severity === "critical" ? "failed" : "warning"}>{a.severity}</Badge>
              <span className="text-fg">{a.message}</span>
              <span className="ml-auto text-xs text-fg-subtle">{a.status} · {timeAgo(a.triggeredAt, now)}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8">
        <AgentCharts data={daily} />
      </div>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Run history</CardTitle>
            <span className="text-xs text-fg-subtle">latest {runs.length}</span>
          </CardHeader>
          {runs.length ? <RunsTable runs={runs} now={now} /> : <div className="p-4"><EmptyState title="No runs yet">Runs appear as soon as this agent sends its first event.</EmptyState></div>}
        </Card>

        <div className="min-w-0 space-y-6">
          <ChatPanel
            key={id}
            agentId={id}
            agentName={card.name}
            enabled={chat.enabled}
            disabledReason={chat.enabled ? undefined : chat.reason}
            permissionMode={chat.enabled ? chat.permissionMode : undefined}
            projectDir={chat.enabled ? chat.projectDir : undefined}
            readableDirs={chat.enabled ? chat.addDirs : []}
            initialMessages={chatMessages}
          />
          {m && (
            <Card>
              <CardHeader>
                <CardTitle>Alert rules</CardTitle>
                <span className="text-xs text-fg-subtle">{m.alert_rules.length}</span>
              </CardHeader>
              <CardContent className="space-y-2">
                {m.alert_rules.length === 0 && <div className="text-sm text-fg-subtle">No alert rules. Add some under <code className="font-mono">alert_rules</code>.</div>}
                {m.alert_rules.map((r) => (
                  <div key={ruleKey(r)} className="flex items-center justify-between gap-2 text-sm">
                    <code className="truncate font-mono text-xs text-fg">{ruleKey(r)}</code>
                    <Badge variant={r.severity === "critical" ? "failed" : "warning"}>{r.severity}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {m && !yaml && m.origin && (
            <Card>
              <CardHeader>
                <CardTitle>Instructions</CardTitle>
                <Link href={`/agents/${encodeURIComponent(id)}/settings#instructions`} className="text-xs text-accent hover:underline">Edit</Link>
              </CardHeader>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-fg-muted">{m.origin.instructions || "(empty)"}</pre>
              <div className="border-t border-border px-4 py-2 text-xs text-fg-subtle">From {m.origin.skillFile}</div>
            </Card>
          )}
          {m && yaml && (
            <Card>
              <CardHeader>
                <CardTitle>Manifest</CardTitle>
                <code className="font-mono text-2xs text-fg-subtle">agents/{m.id}.yaml</code>
              </CardHeader>
              <pre className="max-h-80 overflow-auto p-4 font-mono text-xs leading-relaxed text-fg-muted">{yaml}</pre>
              {m.schedule && (
                <div className="border-t border-border px-4 py-2 text-xs text-fg-subtle">
                  Next fire: {dateTime(nextScheduledRun(m, new Date(now))?.getTime())}
                </div>
              )}
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <ActivityFeed items={activity} showAgent={false} now={now} />
          </Card>
        </div>
      </div>
    </>
  );
}
