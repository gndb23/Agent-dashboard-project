/**
 * Node-only startup work (alert sweeps + manifest watching).
 * Lives in its own file so Next.js never tries to bundle it for the Edge runtime.
 */
import fs from "node:fs";
import { sweepAlerts } from "./lib/service";
import { agentsDir, getRegistry } from "./lib/registry/registry";
import { publish } from "./lib/events/bus";

export function startBackgroundWork() {
  const g = globalThis as unknown as { __agentOpsStarted?: boolean };
  if (g.__agentOpsStarted) return;
  g.__agentOpsStarted = true;

  const safeSweep = () => {
    try {
      sweepAlerts();
    } catch (e) {
      console.error("[agent-ops] alert sweep failed", e);
    }
  };
  safeSweep();
  setInterval(safeSweep, 60_000).unref();

  // Hot-reload manifests: notify open dashboards when agents/ changes.
  try {
    const dir = agentsDir();
    fs.mkdirSync(dir, { recursive: true });
    let timer: NodeJS.Timeout | undefined;
    fs.watch(dir, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        getRegistry();
        safeSweep();
        publish({ kind: "registry" });
      }, 300);
    });
  } catch (e) {
    console.warn("[agent-ops] could not watch agents/ directory", e);
  }
}
