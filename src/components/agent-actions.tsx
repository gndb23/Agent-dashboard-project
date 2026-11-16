"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Play, Square } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "./toaster";
import { useLive } from "./live-provider";

/** Run the agent now / stop it. Polls while running; the run itself shows up live. */
export function RunAgentButton({ agentId, compact }: { agentId: string; compact?: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const { lastEventAt } = useLive();
  const api = `/api/agents/${encodeURIComponent(agentId)}/run`;

  useEffect(() => {
    let cancelled = false;
    fetch(api)
      .then((r) => r.json())
      .then((d: { running: boolean }) => !cancelled && setRunning(d.running))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, lastEventAt]);

  const start = async () => {
    setBusy(true);
    const res = await fetch(api, { method: "POST" });
    const d = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
    setBusy(false);
    if (!res.ok) return toast(d.error ?? "Couldn't start the run", "error");
    setRunning(true);
    toast("Run started. It shows up live in Runs.", "info");
    router.refresh();
  };
  const stop = async () => {
    setBusy(true);
    await fetch(api, { method: "DELETE" });
    setBusy(false);
    setRunning(false);
    toast("Stopping the run…", "info");
  };
  return running ? (
    <Button size="sm" variant="secondary" onClick={stop} disabled={busy}>
      <Square size={11} fill="currentColor" /> {compact ? "Stop" : "Stop run"}
    </Button>
  ) : (
    <Button size="sm" variant={compact ? "secondary" : "primary"} onClick={start} disabled={busy}>
      <Play size={12} fill="currentColor" /> {compact ? "Run" : "Run now"}
    </Button>
  );
}

export function ArchiveAgentButton({ agentId, name }: { agentId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const archive = async () => {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" });
    const d = (await res.json().catch(() => ({}))) as { error?: string; archivedTo?: string };
    if (!res.ok) return toast(d.error ?? "Couldn't archive", "error");
    toast(`${name} archived. Its run history is kept.`);
    router.push("/agents");
    router.refresh();
  };
  return confirming ? (
    <span className="inline-flex items-center gap-2">
      <span className="text-sm text-fg-muted">Archive {name}?</span>
      <Button size="sm" variant="primary" className="!bg-status-failed !text-white" onClick={archive}>Yes, archive</Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
    </span>
  ) : (
    <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
      <Archive size={13} /> Archive agent
    </Button>
  );
}
