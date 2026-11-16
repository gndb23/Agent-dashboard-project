"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { scheduleToCron, nextRuns } from "@/lib/schedule";
import { Button } from "./ui/button";
import { Field, inputCls } from "./ui/field";
import { toast } from "./toaster";

type Draft = { name?: string; description?: string; instructions?: string; schedule?: string; tags?: string[] };
const STEPS = ["Describe", "Instructions", "Schedule", "Folders & links", "Review"];
const PRESETS = ["", "daily 08:00", "weekdays 08:00", "every 2h", "every 30m", "hourly"];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").replace(/-+$/, "").slice(0, 60);

export function AgentWizard({ initial, agents, homeAgentsDir, localTz }: { initial?: Draft; agents: { id: string; name: string }[]; homeAgentsDir: string; localTz: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [idea, setIdea] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    instructions: initial?.instructions ?? "",
    schedule: initial?.schedule ?? "",
    timezone: localTz,
    tags: (initial?.tags ?? []).join(", "),
    folder: "",
    extraDirs: "",
    triggers: [] as string[],
    permissionMode: "default",
    runOnSchedule: true,
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const id = slug(f.name);
  const folder = f.folder.trim() || `${homeAgentsDir}${homeAgentsDir.includes("\\") ? "\\" : "/"}${id || "my-agent"}`;
  const sched = useMemo(() => scheduleToCron(f.schedule), [f.schedule]);
  const preview = "cron" in sched && sched.cron ? nextRuns(sched.cron, f.timezone, 3) : [];

  const draft = async () => {
    if (idea.trim().length < 8) return toast("Describe what the agent should do in a sentence or two.", "error");
    setDrafting(true);
    const res = await fetch("/api/agents/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: idea }) });
    const d = (await res.json().catch(() => ({}))) as { draft?: Draft; error?: string };
    setDrafting(false);
    if (!res.ok || !d.draft) return toast(d.error ?? "Couldn't draft the agent", "error");
    set({
      name: d.draft.name ?? f.name,
      description: d.draft.description ?? f.description,
      instructions: d.draft.instructions ?? f.instructions,
      schedule: d.draft.schedule ?? f.schedule,
      tags: (d.draft.tags ?? []).join(", "),
    });
    toast("Drafted. Check each step and change anything you like.");
  };

  const errors: Record<number, string | null> = {
    0: !f.name.trim() ? "Give the agent a name." : agents.some((a) => a.id === id) ? `An agent called "${id}" already exists.` : null,
    1: null,
    2: "error" in sched ? sched.error : null,
    3: null,
    4: null,
  };
  const next = () => {
    const e = errors[step];
    if (e) return toast(e, "error");
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const create = async () => {
    for (const k of [0, 2]) if (errors[k]) return (setStep(k), toast(errors[k]!, "error"));
    setSaving(true);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: f.name.trim(),
        description: f.description.trim(),
        instructions: f.instructions,
        projectDir: f.folder.trim() || undefined,
        schedule: f.schedule,
        timezone: f.timezone,
        triggers: f.triggers,
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        permissionMode: f.permissionMode,
        runOnSchedule: f.runOnSchedule && "cron" in sched && Boolean(sched.cron),
        extraDirs: f.extraDirs.split("\n").map((d) => d.trim()).filter(Boolean),
      }),
    });
    const d = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    setSaving(false);
    if (!res.ok || !d.id) return toast(d.error ?? "Couldn't create the agent", "error");
    toast(`${f.name} is ready.`);
    router.push(`/agents/${encodeURIComponent(d.id)}`);
    router.refresh();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              onClick={() => (i <= step || !errors[step] ? setStep(i) : toast(errors[step]!, "error"))}
              className={cn(
                "flex w-full items-center gap-2.5 whitespace-nowrap rounded-control px-3 py-2 text-left text-sm cursor-pointer",
                i === step ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-surface-hover",
              )}
            >
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-2xs", i < step ? "border-accent bg-accent text-accent-fg" : i === step ? "border-accent text-accent" : "border-border-strong")}>
                {i < step ? <Check size={11} /> : i + 1}
              </span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      <div className="min-w-0 rounded-card border border-border bg-surface p-6 shadow-card">
        {step === 0 && (
          <div className="space-y-6">
            <div className="rounded-card border border-accent/35 bg-accent-soft p-4">
              <div className="flex items-center gap-2 text-sm font-semibold"><Wand2 size={15} className="text-accent" /> Describe it, let AI fill in the rest</div>
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={3}
                placeholder="e.g. Every weekday at 8am, check my Shopify stock against the stock list in C:\Stock\list.xlsx and email me anything below 5 units."
                className={cn(inputCls, "mt-3 bg-surface")}
              />
              <Button className="mt-3" variant="primary" onClick={draft} disabled={drafting}>
                <Sparkles size={13} /> {drafting ? "Drafting… (about 20 seconds)" : "Draft my agent"}
              </Button>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Name" hint={id ? <>Id: <code className="font-mono">{id}</code></> : "Shown everywhere in the dashboard"}>
                <input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Daily Inventory Sync" autoFocus />
              </Field>
              <Field label="Tags" hint="Comma-separated, optional">
                <input className={inputCls} value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="shopify, daily" />
              </Field>
            </div>
            <Field label="What does it do?" hint="One line">
              <input className={inputCls} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Compares Shopify stock with my stock list and reports differences" />
            </Field>
          </div>
        )}

        {step === 1 && (
          <Field label="Instructions" hint="What the agent does each time it runs. Saved as CLAUDE.md in its folder; Claude reads it automatically. Markdown is fine.">
            <textarea
              className={cn(inputCls, "min-h-[360px] font-mono text-xs leading-relaxed")}
              value={f.instructions}
              onChange={(e) => set({ instructions: e.target.value })}
              placeholder={"## Goal\n…\n\n## Steps\n1. …\n2. …\n\n## Output\nSave the result to …"}
            />
          </Field>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <Field label="When should it run?" hint='Pick one, or type: "daily 05:30", "weekdays 08:00", "every 30m", "every 2h", or a cron like "0 5 * * *". Leave empty to run only when you click Run.'>
              <input className={inputCls} value={f.schedule} onChange={(e) => set({ schedule: e.target.value })} placeholder="on demand" />
            </Field>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button key={p || "none"} onClick={() => set({ schedule: p })} className={cn("rounded-full border px-3 py-1 text-xs cursor-pointer", f.schedule === p ? "border-accent bg-accent-soft text-fg" : "border-border text-fg-muted hover:border-border-strong")}>
                  {p || "on demand"}
                </button>
              ))}
            </div>
            {"error" in sched ? (
              <p className="text-sm text-status-failed-fg">{sched.error}</p>
            ) : sched.cron ? (
              <div className="rounded-control border border-border bg-surface-2 p-3 text-sm">
                <div className="text-fg">Runs {sched.label}</div>
                <div className="mt-1 text-xs text-fg-subtle">Next: {preview.map((d) => d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: f.timezone })).join(" · ")}</div>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">On demand: it runs when you click <strong>Run now</strong>.</p>
            )}
            {"cron" in sched && sched.cron && (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Time zone">
                  <input className={inputCls} value={f.timezone} onChange={(e) => set({ timezone: e.target.value })} />
                </Field>
                <label className="flex items-start gap-3 rounded-control border border-border p-3">
                  <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={f.runOnSchedule} onChange={(e) => set({ runOnSchedule: e.target.checked })} />
                  <span>
                    <span className="block text-sm font-medium text-fg">Run it on this schedule from Agent Ops</span>
                    <span className="block text-xs text-fg-subtle">While Agent Ops is running on this computer. Untick if something else (like the Claude app) runs it.</span>
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <Field label="Working folder" hint="Where the agent works and keeps its files. Created if it doesn't exist.">
              <input className={cn(inputCls, "font-mono text-xs")} value={f.folder} onChange={(e) => set({ folder: e.target.value })} placeholder={folder} />
            </Field>
            <Field label="Other folders it can read" hint="One full path per line, e.g. where your stock list or reports live. Optional.">
              <textarea className={cn(inputCls, "font-mono text-xs")} rows={3} value={f.extraDirs} onChange={(e) => set({ extraDirs: e.target.value })} placeholder={"C:\\Users\\you\\Documents\\Stock"} />
            </Field>
            <Field label="What may it do when you chat with it?">
              <select className={inputCls} value={f.permissionMode} onChange={(e) => set({ permissionMode: e.target.value })}>
                <option value="default">Read and answer only (safest)</option>
                <option value="plan">Plan changes, but don&apos;t make them</option>
                <option value="acceptEdits">Edit files in its folders</option>
              </select>
            </Field>
            {agents.length > 0 && (
              <Field label="Hands work to" hint="Draws links on the Workflow page. Optional.">
                <div className="flex flex-wrap gap-2">
                  {agents.map((a) => {
                    const on = f.triggers.includes(a.id);
                    return (
                      <button key={a.id} onClick={(e) => (e.preventDefault(), set({ triggers: on ? f.triggers.filter((t) => t !== a.id) : [...f.triggers, a.id] }))} className={cn("rounded-full border px-3 py-1 text-xs cursor-pointer", on ? "border-accent bg-accent-soft text-fg" : "border-border text-fg-muted hover:border-border-strong")}>
                        {on && <Check size={11} className="mr-1 inline" />}
                        {a.name}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
          </div>
        )}

        {step === 4 && (
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-[160px_minmax(0,1fr)]">
            {[
              ["Name", `${f.name} (${id})`],
              ["Does", f.description || "—"],
              ["Schedule", "cron" in sched ? `${sched.label}${sched.cron ? ` (${f.timezone})${f.runOnSchedule ? ", run by Agent Ops" : ""}` : ""}` : "—"],
              ["Working folder", folder],
              ["Can also read", f.extraDirs.trim() || "—"],
              ["Hands work to", f.triggers.length ? f.triggers.join(", ") : "—"],
              ["Chat permissions", { default: "Read and answer only", plan: "Plan only", acceptEdits: "Can edit files" }[f.permissionMode]],
              ["Instructions", f.instructions.trim() ? `${f.instructions.trim().split("\n").length} lines` : "Empty: you can add them later"],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-fg-subtle">{k}</dt>
                <dd className="break-words text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronLeft size={14} /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={next}>
              Next <ChevronRight size={14} />
            </Button>
          ) : (
            <Button variant="primary" onClick={create} disabled={saving}>
              <Check size={14} /> {saving ? "Creating…" : "Create agent"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
