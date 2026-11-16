/**
 * Guard for endpoints that run commands on this machine (chat).
 * Rejects anything that is not a same-origin request addressed to localhost:
 * - other machines on the network (Host is not a loopback name)
 * - other websites open in your browser (cross-site Origin / Sec-Fetch-Site), incl. DNS rebinding
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostname(hostHeader: string): string {
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0].toLowerCase();
}

export function localOnlyError(req: Request): string | null {
  const host = req.headers.get("host") ?? "";
  if (!LOOPBACK.has(hostname(host))) return "Chat is only available when the dashboard is opened via localhost.";
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const o = new URL(origin);
      if (!LOOPBACK.has(o.hostname.toLowerCase()) || o.host !== host) return "Cross-origin requests are not allowed.";
    } catch {
      return "Cross-origin requests are not allowed.";
    }
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "Cross-site requests are not allowed.";
  return null;
}
