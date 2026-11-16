"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { scheduleToCron, nextRuns } from "@/lib/schedule";
import type { AgentManifest } from "@/lib/registry/manifest";
import { Button } from "./ui/button";
import { Field, inputCls } from "./ui/field";
import { toast } from "./toaster";
import { ArchiveAgentButton } from "./agent-actions";

type Rules = AgentManifest["alert_rules"];
const ruleNum = (rules: Rules, type: Rules[number]["type"], key: string): string => {
  const r = rules.find((x) => x.type === type) as Record<string, unknown> | undefined;
  return r && typeof r[key] === "number" ? String(r[key]) : "";
};

function Section({ title, desc, children, id }: { title: string; desc?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-20 grid gap-6 border-b border-border py-8 first:pt-0 last:border-0 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div>
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {desc && <p className="mt-1 text-sm text-fg-muted">{desc}</p>}
      </div>
      <div className="min-w-0 space-y-5">{children}</div>
    </section>
  );
}

export function AgentSettings({
  agent, allAgents, instructions, instructionsFile, hasFile,
}: {
  agent: AgentManifest; allAgents: { id: string; name: string }[]; instructions: string; instructionsFile: string | null; hasFile: boolean;
}) {
  const router = useRouter();
  const scheduleFromApp = agent.origin?.cronSource === "app";
  const [f, setF] = useState({
    name: agent.name,
    description: agent.description,
    tags: agent.tags.join(", "),
    scheduleText: agent.schedule ?? "",
    timezone: agent.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    onSchedule: agent.run?.on_schedule ?? false,
    projectDir: agent.project_dir ?? "",
    extraDirs: agent.extra_dirs.join("\n"),
    chatMode: agent.chat?.permission_mode ?? "default",
    runMode: agent.run?.permission_mode ?? "",
    maxMinutes: String(agent.run?.max_minutes ?? 30),
    runPrompt: agent.run?.prompt ?? "",
    triggers: agent.triggers,
    failStreak: ruleNum(agent.alert_rules, "consecutive_failures", "threshold"),
    missedHours: ruleNum(agent.alert_rules, "no_run_within", "hours"),
    slowMinutes: ruleNum(agent.alert_rules, "runtime_exceeds", "minutes"),
    costUsd: ruleNum(agent.alert_rules, "cost_per_run_exceeds", "usd"),
  });
  const [text, setText] = useState(instructions);
  const [saving, setSaving] = useState(false);
  const [savingText, setSavingText] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const sched = scheduleToCron(f.scheduleText);
  const preview = "cron" in sched && sched.cron ? nextRuns(sched.cron, f.timezone, 3) : [];

  const save = async () => {
    if (!scheduleFromApp && "error" in sched) return toast(sched.error, "error");
    const keep = agent.alert_rules.filter((r) => !["consecutive_failures", "no_run_within", "runtime_exceeds", "cost_per_run_exceeds"].includes(r.type));
    const sev = (type: string) => (agent.alert_rules.find((r) => r.type === type)?.severity ?? "warning") as "warning" | "critical";
    const rules: Rules = [...keep];
    if (Number(f.failStreak) > 0) rules.push({ type: "consecutive_failures", threshold: Math.round(Number(f.failStreak)), severity: sev("consecutive_failures") });
    if (Number(f.missedHours) > 0) rules.push({ type: "no_run_within", hours: Number(f.missedHours), severity: sev("no_run_within") });
    if (Number(f.slowMinutes) > 0) rules.push({ type: "runtime_exceeds", minutes: Number(f.slowMinutes), severity: sev("runtime_exceeds") });
    if (Number(f.costUsd) > 0) rules.push({ type: "cost_per_run_exceeds", usd: Number(f.costUsd), severity: sev("cost_per_run_exceeds") });
    setSaving(true);
    const res = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: f.name.trim(),
        description: f.description.trim(),
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        ...(scheduleFromApp ? {} : { scheduleText: f.scheduleText, timezone: "cron" in sched && sched.cron ? f.timezone : null }),
        project_dir: f.projectDir.trim(),
        extra_dirs: f.extraDirs.split("\n").map((d) => d.trim()).filter(Boolean),
        triggers: f.triggers,
        chat: { permission_mode: f.chatMode },
        run: {
          on_schedule: !agent.origin && f.onSchedule,
          max_minutes: Number(f.maxMinutes) > 0 ? Number(f.maxMinutes) : 30,
          ...(f.runMode ? { permission_mode: f.runMode } : {}),
          ...(f.runPrompt.trim() ? { prompt: f.runPrompt.trim() } : {}),
        },
        alert_rules: rules,
      }),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    setSaving(false);
    if (!res.ok) return toast(d.error ?? "Couldn't save", "error");
    toast("Saved");
    router.refresh();
  };

  const saveText = async () => {
    setSavingText(true);
    const res = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/instructions`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    setSavingText(false);
    if (!res.ok) return toast(d.error ?? "Couldn't save the instructions", "error");
    toast(agent.origin ? "Instructions saved. The Claude app uses them from the next run." : "Instructions saved");
    router.refresh();
  };

  const others = allAgents.filter((a) => a.id !== agent.id);
  return (
    <div className="rounded-card border border-border bg-surface px-6 py-2 shadow-card">
      <Section title="General">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Tags" hint="Comma-separated"><input className={inputCls} value={f.tags} onChange={(e) => set({ tags: e.target.value })} /></Field>
        </div>
        <Field label="What does it do?"><input className={inputCls} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      </Section>

      <Section title="Instructions" id="instructions" desc={agent.origin ? "This is the Claude scheduled task's prompt (SKILL.md). Changes apply from its next run." : "Saved as CLAUDE.md in the agent's working folder. Claude reads it in every run and chat."}>
        {instructionsFile ? (
          <>
            <textarea className={cn(inputCls, "min-h-[320px] font-mono text-xs leading-relaxed")} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-mono text-2xs text-fg-subtle">{instructionsFile}</span>
              <Button variant="secondary" onClick={saveText} disabled={savingText || text === instructions}>
                <Save size={13} /> {savingText ? "Saving…" : "Save instructions"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-fg-muted">Set a working folder below and save, then you can write instructions here.</p>
        )}
      </Section>

      <Section title="Schedule" desc={scheduleFromApp ? "Set in the Claude app." : 'e.g. "daily 05:30", "weekdays 08:00", "every 30m", a cron, or empty for on demand.'}>
        {scheduleFromApp ? (
          <div className="rounded-control border border-border bg-surface-2 p-3 text-sm">
            <div className="text-fg"><code className="font-mono">{agent.schedule}</code> ({agent.timezone})</div>
            <div className="mt-1 text-xs text-fg-subtle">Change it in the Claude app: Scheduled → {agent.origin?.taskName} → Edit. It updates here within a minute.</div>
          </div>
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="When"><input className={inputCls} value={f.scheduleText} onChange={(e) => set({ scheduleText: e.target.value })} placeholder="on demand" /></Field>
              <Field label="Time zone"><input className={inputCls} value={f.timezone} onChange={(e) => set({ timezone: e.target.value })} /></Field>
            </div>
            {"error" in sched ? <p className="text-sm text-status-failed-fg">{sched.error}</p> : sched.cron ? <p className="text-xs text-fg-subtle">{sched.label}. Next: {preview.map((d) => d.toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: f.timezone })).join(" · ")}</p> : null}
            {"cron" in sched && sched.cron && !agent.origin && (
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={f.onSchedule} onChange={(e) => set({ onSchedule: e.target.checked })} />
                <span className="text-sm text-fg">Run it on this schedule from Agent Ops <span className="block text-xs text-fg-subtle">While Agent Ops is running. Untick if something else runs it.</span></span>
              </label>
            )}
          </>
        )}
      </Section>

      <Section title="Folders" desc="Where it works, and what else it may read in chats and runs.">
        <Field label="Working folder" hint={agent.origin && !agent.project_dir ? `Default: the task's folder (${agent.origin.taskDir})` : "Full path"}>
          <input className={cn(inputCls, "font-mono text-xs")} value={f.projectDir} onChange={(e) => set({ projectDir: e.target.value })} placeholder={agent.origin?.taskDir ?? "C:\\Users\\you\\agents\\my-agent"} />
        </Field>
        <Field label="Other folders it can read" hint="One full path per line">
          <textarea className={cn(inputCls, "font-mono text-xs")} rows={3} value={f.extraDirs} onChange={(e) => set({ extraDirs: e.target.value })} />
        </Field>
      </Section>

      <Section title="Permissions" desc="What it may do without asking. Runs from Agent Ops have nobody to approve actions, so pick carefully.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="In chat">
            <select className={inputCls} value={f.chatMode} onChange={(e) => set({ chatMode: e.target.value as typeof f.chatMode })}>
              <option value="default">Read and answer only</option>
              <option value="plan">Plan, don&apos;t change</option>
              <option value="acceptEdits">Edit files in its folders</option>
            </select>
          </Field>
          <Field label="In runs (Run now / schedule)" hint={agent.origin?.permissionMode ? `Claude task setting: ${agent.origin.permissionMode}` : undefined}>
            <select className={inputCls} value={f.runMode} onChange={(e) => set({ runMode: e.target.value })}>
              <option value="">{agent.origin?.permissionMode ? "Same as the Claude task" : "Edit files (default)"}</option>
              <option value="default">Read only</option>
              <option value="acceptEdits">Edit files</option>
              <option value="auto">Auto (Claude decides; blocks risky actions)</option>
              <option value="bypassPermissions">Everything, including commands (risky)</option>
            </select>
          </Field>
          <Field label="Stop a run after (minutes)"><input type="number" min={1} className={inputCls} value={f.maxMinutes} onChange={(e) => set({ maxMinutes: e.target.value })} /></Field>
          <Field label="Message to start a run" hint="Optional. Default: do your job per your instructions."><input className={inputCls} value={f.runPrompt} onChange={(e) => set({ runPrompt: e.target.value })} /></Field>
        </div>
      </Section>

      <Section title="Alerts" desc="Leave a box empty to turn that alert off.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Failed runs in a row"><input type="number" min={0} className={inputCls} value={f.failStreak} onChange={(e) => set({ failStreak: e.target.value })} placeholder="off" /></Field>
          <Field label="No run for (hours)"><input type="number" min={0} className={inputCls} value={f.missedHours} onChange={(e) => set({ missedHours: e.target.value })} placeholder="off" /></Field>
          <Field label="Run takes longer than (minutes)"><input type="number" min={0} className={inputCls} value={f.slowMinutes} onChange={(e) => set({ slowMinutes: e.target.value })} placeholder="off" /></Field>
          <Field label="One run costs more than ($)"><input type="number" min={0} step="0.01" className={inputCls} value={f.costUsd} onChange={(e) => set({ costUsd: e.target.value })} placeholder="off" /></Field>
        </div>
      </Section>

      {others.length > 0 && (
        <Section title="Links" desc="Agents this one hands work to (Workflow page).">
          <div className="flex flex-wrap gap-2">
            {others.map((a) => {
              const on = f.triggers.includes(a.id);
              return (
                <button key={a.id} onClick={() => set({ triggers: on ? f.triggers.filter((t) => t !== a.id) : [...f.triggers, a.id] })} className={cn("rounded-full border px-3 py-1 text-xs cursor-pointer", on ? "border-accent bg-accent-soft text-fg" : "border-border text-fg-muted hover:border-border-strong")}>
                  {on && <Check size={11} className="mr-1 inline" />}
                  {a.name}
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface/95 px-6 py-4 backdrop-blur">
        {hasFile ? <ArchiveAgentButton agentId={agent.id} name={agent.name} /> : <span className="text-xs text-fg-subtle">{agent.origin ? "To remove this agent, delete the task in the Claude app." : ""}</span>}
        <Button variant="primary" onClick={save} disabled={saving}>
          <Save size={13} /> {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
