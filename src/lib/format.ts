export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return "—";
  const diff = now - ts;
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  const fmt = (v: string) => (future ? `in ${v}` : `${v} ago`);
  if (s < 45) return future ? "in a moment" : "just now";
  if (s < 3600) return fmt(`${Math.round(s / 60)}m`);
  if (s < 86400) return fmt(`${Math.round(s / 3600)}h`);
  return fmt(`${Math.round(s / 86400)}d`);
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function usd(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  return `$${n.toFixed(n > 0 && n < 0.01 ? 4 : digits)}`;
}

export function compact(n: number | null | undefined): string {
  if (n == null) return "—";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n * 1000) / 10}%`;
}

export function dateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
