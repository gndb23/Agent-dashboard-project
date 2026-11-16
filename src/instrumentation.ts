/** Starts background work once per server process (Node runtime only). */
export async function register() {
  // Keep this as a positive check with the import inside it: Next.js removes the branch
  // from the Edge bundle, so Node-only code (fs, SQLite) is never compiled for Edge.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundWork } = await import("./instrumentation-node");
    startBackgroundWork();
  }
}
