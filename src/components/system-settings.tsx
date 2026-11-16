"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FolderPlus, Loader2, LogIn, RefreshCw, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { inputCls } from "./ui/field";
import { toast } from "./toaster";

type Check = { id: string; label: string; ok: boolean; detail: string; fix?: { label: string; action: string } };
type System = {
  checks: Check[];
  git: { commit?: string; branch?: string; isRepo: boolean };
  supervised: boolean;
  settings: { taskDirs: string[]; autoImportHistory: boolean; notifications: boolean; claudeAppDir?: string };
  tasks: { taskRoots: { dir: string; exists: boolean; tasks: number }[]; appDirs: { dir: string; exists: boolean }[]; appFiles: string[]; errors: string[]; scannedAt: number };
  demo: boolean;
  platform: string;
};

function Card({ title, desc, children, id, aside }: { title: string; desc?: string; children: React.ReactNode; id?: string; aside?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-card border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {desc && <p className="mt-0.5 text-sm text-fg-muted">{desc}</p>}
        </div>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function LoginFlow({ onDone }: { onDone: () => void }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [state, setState] = useState<"starting" | "waiting" | "done" | "error">("starting");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let stop = false;
    (async () => {
      const r = await fetch("/api/system/login", { method: "POST" });
      const d = (await r.json().catch(() => ({}))) as { urls?: string[]; error?: string };
      if (!r.ok) return (setState("error"), setMsg(d.error ?? "Couldn't start the sign-in."));
      setUrls(d.urls ?? []);
      setState("waiting");
      for (let i = 0; i < 300 && !stop; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const s = (await (await fetch("/api/system/login")).json()) as { status: { loggedIn?: boolean }; login: { urls: string[]; running: boolean; output: string } | null };
        if (s.login?.urls?.length) setUrls(s.login.urls);
        if (s.status.loggedIn) {
          setState("done");
          toast("Signed in to Claude");
          onDone();
          return;
        }
        if (s.login && !s.login.running) {
          setState("error");
          setMsg(s.login.output.split("\n").filter(Boolean).slice(-2).join(" ") || "Sign-in ended without logging in.");
          return;
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [onDone]);

  const sendCode = async () => {
    if (!code.trim()) return;
    const r = await fetch("/api/system/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    if (!r.ok) toast(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't send the code", "error");
    else (setCode(""), toast("Code sent. Finishing sign-in…", "info"));
  };

  return (
    <div className="mt-3 rounded-control border border-accent/40 bg-accent-soft p-4 text-sm">
      {state === "starting" && <p className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Starting sign-in…</p>}
      {state === "waiting" && (
        <>
          <p className="font-medium text-fg">Sign in to Claude in your browser</p>
          <p className="mt-1 text-fg-muted">A sign-in page may have opened by itself. If not, use the button. If the page shows a code, paste it here.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {urls[0] && (
              <a href={urls[0]} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-control bg-accent px-3 font-semibold text-accent-fg hover:opacity-90">
                <ExternalLink size={13} /> Open sign-in page
              </a>
            )}
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste code (if asked)" className={cn(inputCls, "w-64")} />
            <Button size="md" variant="secondary" onClick={sendCode} disabled={!code.trim()}>Send code</Button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-subtle"><Loader2 size={12} className="animate-spin" /> Waiting for you to finish…</p>
        </>
      )}
      {state === "done" && <p className="flex items-center gap-2 text-status-success-fg"><CheckCircle2 size={14} /> Signed in.</p>}
      {state === "error" && <p className="text-status-failed-fg">{msg}</p>}
    </div>
  );
}

export function SystemSettings() {
  const router = useRouter();
  const [sys, setSys] = useState<System | null>(null);
  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [update, setUpdate] = useState<{ behind: number; error?: string } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [newDir, setNewDir] = useState("");
  const [notify, setNotify] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSys((await (await fetch("/api/system")).json()) as System);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    try {
      setNotify(localStorage.getItem("agent-ops-notify") === "1");
    } catch {}
  }, [load]);

  const post = async (url: string, label: string, init: RequestInit = { method: "POST" }) => {
    setBusy(label);
    const r = await fetch(url, init);
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    setBusy(null);
    if (!r.ok) {
      toast(d.error ?? `${label} failed`, "error");
      return null;
    }
    return d;
  };

  const fix = async (action: string) => {
    if (action === "login") return setLogin(true);
    if (action === "hooks") {
      const d = await post("/api/system/hooks", "Installing hooks");
      if (d) (toast("Hooks installed. New Claude Code sessions will report here."), load());
    }
  };

  const checkUpdate = async () => {
    setBusy("Checking");
    const d = (await (await fetch("/api/system/update")).json()) as { behind: number; error?: string };
    setBusy(null);
    setUpdate(d);
    if (d.error) toast(d.error, "error");
  };
  const doUpdate = async () => {
    const d = await post("/api/system/update", "Update");
    if (!d) return;
    setUpdating(true);
    await new Promise((r) => setTimeout(r, 4000));
    for (let i = 0; i < 300; i++) {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (r.ok && (await r.json()).ok) return window.location.reload();
      } catch {}
      await new Promise((r) => setTimeout(r, 3000));
    }
  };

  const saveSettings = async (patch: Partial<System["settings"]>) => {
    const d = await post("/api/system/settings", "Saving", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (d) (toast("Saved"), load(), router.refresh());
  };

  const sync = async () => {
    const d = (await post("/api/system/sync", "Syncing")) as { tasks: number; history: { imported: number } | null } | null;
    if (d) (toast(`Found ${d.tasks} Claude task${d.tasks === 1 ? "" : "s"}${d.history ? `, imported ${d.history.imported} new session${d.history.imported === 1 ? "" : "s"}` : ""}.`), load(), router.refresh());
  };

  const toggleNotify = async () => {
    const next = !notify;
    if (next && "Notification" in window && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") return toast("Notifications are blocked in this browser.", "error");
    }
    try {
      localStorage.setItem("agent-ops-notify", next ? "1" : "0");
    } catch {}
    setNotify(next);
    toast(next ? "You'll get a desktop notification when an alert opens." : "Notifications off");
  };

  const removeDemo = async () => {
    const d = await post("/api/system/demo", "Removing demo data", { method: "DELETE" });
    if (d) (toast("Demo data removed"), load(), router.refresh());
  };

  if (!sys) {
    return (
      <div className="space-y-4" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-40 !rounded-card" />
        ))}
      </div>
    );
  }
  const failing = sys.checks.filter((c) => !c.ok && c.id !== "supervisor");
  const t = sys.tasks;
  const found = t.taskRoots.reduce((a, r) => a + r.tasks, 0);

  return (
    <div className="space-y-6">
      <Card
        title="Health"
        desc={failing.length ? `${failing.length} thing${failing.length > 1 ? "s" : ""} need${failing.length > 1 ? "" : "s"} attention.` : "Everything is working."}
        aside={<Button size="sm" variant="ghost" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Re-check</Button>}
      >
        <ul className="divide-y divide-border">
          {sys.checks.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              {c.ok ? <CheckCircle2 size={16} className="shrink-0 text-status-success" /> : <AlertTriangle size={16} className={cn("shrink-0", c.id === "supervisor" ? "text-fg-subtle" : "text-status-warning")} />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-fg">{c.label}</div>
                <div className="truncate text-xs text-fg-subtle" title={c.detail}>{c.detail}</div>
              </div>
              {c.fix && (
                <Button size="sm" variant="primary" onClick={() => fix(c.fix!.action)} disabled={busy !== null}>
                  {c.fix.action === "login" ? <LogIn size={13} /> : null} {c.fix.label}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {login && <LoginFlow onDone={() => (setLogin(false), load())} />}
      </Card>

      <Card id="tasks" title="Claude scheduled tasks" desc="Tasks you create in the Claude app appear as agents automatically, and their runs are imported." aside={<Button size="sm" variant="secondary" onClick={sync} disabled={busy !== null}><RefreshCw size={13} /> Sync now</Button>}>
        <p className="text-sm text-fg">
          <strong>{found}</strong> task{found === 1 ? "" : "s"} found{t.appFiles.length ? ", with schedules from the Claude app" : ""}. Last checked {new Date(t.scannedAt).toLocaleTimeString()}.
        </p>
        <div className="mt-4 space-y-1.5 text-xs">
          <div className="eyebrow">Folders searched for tasks</div>
          {t.taskRoots.map((r) => (
            <div key={r.dir} className="flex items-center gap-2 font-mono">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", r.exists ? "bg-status-success" : "bg-status-idle")} />
              <span className="truncate text-fg-muted" title={r.dir}>{r.dir}</span>
              <span className="shrink-0 text-fg-subtle">{r.exists ? `${r.tasks} task${r.tasks === 1 ? "" : "s"}` : "not found"}</span>
              {sys.settings.taskDirs.includes(r.dir) && (
                <button onClick={() => saveSettings({ taskDirs: sys.settings.taskDirs.filter((d) => d !== r.dir) })} className="text-fg-subtle hover:text-status-failed-fg cursor-pointer" aria-label="Remove folder"><X size={12} /></button>
              )}
            </div>
          ))}
          <div className="eyebrow pt-3">Claude app settings files</div>
          {t.appFiles.length ? t.appFiles.map((f) => <div key={f} className="truncate font-mono text-fg-muted" title={f}>{f}</div>) : <div className="text-fg-subtle">None found yet in {t.appDirs.map((d) => d.dir).join(", ")}. Schedules will show once the Claude app has saved a local task.</div>}
          {t.errors.length > 0 && <div className="pt-2 text-status-warning-fg">{t.errors.slice(0, 3).join(" · ")}</div>}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input value={newDir} onChange={(e) => setNewDir(e.target.value)} placeholder="Add another folder with tasks (full path)" className={cn(inputCls, "w-96 max-w-full font-mono text-xs")} />
          <Button size="md" variant="secondary" onClick={() => newDir.trim() && (saveSettings({ taskDirs: [...sys.settings.taskDirs, newDir.trim()] }), setNewDir(""))} disabled={!newDir.trim()}>
            <FolderPlus size={13} /> Add folder
          </Button>
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm">
          <input type="checkbox" className="accent-[var(--accent)]" checked={sys.settings.autoImportHistory} onChange={(e) => saveSettings({ autoImportHistory: e.target.checked })} />
          Import Claude Code session history in the background (every 2 minutes)
        </label>
      </Card>

      <Card title="Updates" desc={sys.git.isRepo ? `Version ${sys.git.commit ?? "?"}${sys.git.branch ? ` on ${sys.git.branch}` : ""}` : "Not installed from git"}>
        {updating ? (
          <p className="flex items-center gap-2 text-sm text-fg"><Loader2 size={14} className="animate-spin" /> Updating… this page reloads by itself when it&apos;s done (usually 1–3 minutes).</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={checkUpdate} disabled={busy !== null || !sys.git.isRepo}>
              <RefreshCw size={13} className={busy === "Checking" ? "animate-spin" : ""} /> Check for updates
            </Button>
            {update && !update.error && (update.behind > 0 ? (
              <>
                <span className="text-sm text-fg">{update.behind} new change{update.behind === 1 ? "" : "s"} available.</span>
                <Button variant="primary" onClick={doUpdate} disabled={!sys.supervised} title={sys.supervised ? undefined : "Open Agent Ops with the desktop shortcut to update from here"}>
                  <Download size={13} /> Update now
                </Button>
              </>
            ) : (
              <span className="text-sm text-fg-muted">You&apos;re on the latest version.</span>
            ))}
            {!sys.supervised && <span className="text-xs text-fg-subtle">Updating from here works when Agent Ops was opened with its desktop shortcut.</span>}
          </div>
        )}
      </Card>

      <Card title="Notifications" desc="Get a desktop notification from this browser when an alert opens (while a dashboard tab is open).">
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="accent-[var(--accent)]" checked={notify} onChange={toggleNotify} />
          Desktop notifications for new alerts
        </label>
      </Card>

      <Card id="demo" title="Demo data" desc="Sample agents and runs created by the demo seed.">
        {sys.demo ? (
          <Button variant="secondary" onClick={removeDemo} disabled={busy !== null}>
            <Trash2 size={13} /> Remove demo data
          </Button>
        ) : (
          <p className="text-sm text-fg-muted">No demo data. Everything you see is real.</p>
        )}
      </Card>

      {sys.platform === "win32" && (
        <Card title="On this computer" desc="Agent Ops starts by itself when you log in to Windows and runs in the background. Open it with the Agent Ops shortcut on your desktop.">
          <p className="text-sm text-fg-muted">
            To stop it starting automatically, ask Claude to run <code className="font-mono text-xs">scripts\windows\uninstall.ps1</code> in this folder. Your data and agents stay.
          </p>
        </Card>
      )}
    </div>
  );
}
