/** Starts background work once per server process (Node runtime only). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __agentOpsStarted?: boolean };
  if (g.__agentOpsStarted) return;
  g.__agentOpsStarted = true;

  const fs = await import("node:fs");
  const { sweepAlerts } = await import("./lib/service");
  const { agentsDir, getRegistry } = await import("./lib/registry/registry");
  const { publish } = await import("./lib/events/bus");

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
