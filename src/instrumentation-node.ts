/**
 * Node-only background work:
 * - alert sweeps (every 60 s)
 * - live sync of agents: manifests in agents/ and Claude Desktop scheduled tasks (watch + 10 s check)
 * - import of Claude Code session history, so scheduled-task runs appear (every 2 min)
 * - the optional built-in scheduler for agents with run.on_schedule (every 30 s)
 */
import fs from "node:fs";
import { sweepAlerts, syncHistory } from "./lib/service";
import { agentsDir, getRegistry, registrySignature } from "./lib/registry/registry";
import { publish } from "./lib/events/bus";
import { taskRoots } from "./lib/claude-tasks/discover";

const safe = (name: string, fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    console.error(`[agent-ops] ${name} failed`, e);
  }
};

export function startBackgroundWork() {
  const g = globalThis as unknown as { __agentOpsStarted?: boolean };
  if (g.__agentOpsStarted) return;
  g.__agentOpsStarted = true;

  safe("alert sweep", sweepAlerts);
  setInterval(() => safe("alert sweep", sweepAlerts), 60_000).unref();

  // Agents: notify open dashboards whenever a manifest or a Claude task appears, changes or goes away.
  let lastSig = "";
  const checkRegistry = () =>
    safe("registry check", () => {
      const sig = registrySignature();
      if (sig !== lastSig) {
        const first = lastSig === "";
        lastSig = sig;
        if (!first) {
          sweepAlerts();
          publish({ kind: "registry" });
        }
      }
    });
  checkRegistry();
  setInterval(checkRegistry, 10_000).unref();
  let debounce: NodeJS.Timeout | undefined;
  const onChange = () => {
    clearTimeout(debounce);
    debounce = setTimeout(checkRegistry, 400);
  };
  for (const dir of [agentsDir(), ...taskRoots()]) {
    try {
      if (dir === agentsDir()) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(dir)) fs.watch(dir, { recursive: process.platform !== "linux" }, onChange);
    } catch (e) {
      console.warn(`[agent-ops] could not watch ${dir}`, e);
    }
  }

  // Session history (runs of Claude scheduled tasks and other Claude Code sessions).
  setTimeout(() => safe("history import", () => syncHistory()), 5_000).unref();
  setInterval(() => safe("history import", () => syncHistory()), 120_000).unref();

  getRegistry();
  void import("./lib/runner/scheduler").then((m) => m.startScheduler()).catch((e) => console.error("[agent-ops] scheduler failed to start", e));
}
