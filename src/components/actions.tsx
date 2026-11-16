"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, FilePlus2 } from "lucide-react";
import { Button } from "./ui/button";

export function CreateManifestButton({ agentId, type }: { agentId: string; type?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState("");
  const create = async () => {
    setState("busy");
    const res = await fetch("/api/manifests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, type }),
    });
    if (res.ok) {
      router.refresh();
      setState("idle");
    } else {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Failed");
      setState("error");
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="primary" onClick={create} disabled={state === "busy"}>
        <FilePlus2 size={13} /> {state === "busy" ? "Creating…" : "Create manifest"}
      </Button>
      {state === "error" && <span className="text-[12px] text-status-failed">{error}</span>}
    </span>
  );
}

export function AlertActions({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const set = async (next: "acknowledged" | "resolved") => {
    setBusy(true);
    await fetch(`/api/alerts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    router.refresh();
  };
  if (status === "resolved") return null;
  return (
    <span className="inline-flex gap-1.5">
      {status === "open" && (
        <Button size="sm" onClick={() => set("acknowledged")} disabled={busy}>
          Acknowledge
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => set("resolved")} disabled={busy}>
        Resolve
      </Button>
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <Button size="sm" variant="ghost" onClick={copy} aria-label={label}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copied" : label}
    </Button>
  );
}
