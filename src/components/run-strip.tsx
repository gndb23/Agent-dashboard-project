import type { RunView } from "@/lib/queries";

const FILL: Record<string, string> = {
  success: "var(--status-success)",
  running: "var(--status-running)",
  warning: "var(--status-warning)",
  failed: "var(--status-failed)",
  idle: "var(--status-idle)",
};

/**
 * Compact sparkline of recent runs (oldest → newest). Bar height = relative
 * duration, color = outcome. Pure SVG, no client JS.
 */
export function RunStrip({ runs, slots = 24, height = 28 }: { runs: RunView[]; slots?: number; height?: number }) {
  const list = runs.slice(0, slots).reverse();
  const durations = list.map((r) => r.durationMs ?? (r.lastEventAt - r.startedAt));
  const max = Math.max(1, ...durations);
  const gap = 2;
  const w = 6;
  const width = slots * (w + gap) - gap;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block" role="img" aria-label={`Last ${list.length} runs`}>
      {Array.from({ length: slots }).map((_, i) => {
        const r = list[i - (slots - list.length)];
        const x = i * (w + gap);
        if (!r) return <rect key={i} x={x} y={height - 3} width={w} height={3} rx={1} fill="var(--border)" />;
        const h = Math.max(4, (durations[list.indexOf(r)] / max) * (height - 2));
        return (
          <rect key={i} x={x} y={height - h} width={w} height={h} rx={1.5} fill={FILL[r.displayStatus]} opacity={r.displayStatus === "success" ? 0.75 : 1}>
            <title>{`${r.status}${r.title ? ` · ${r.title}` : ""}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
