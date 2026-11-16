"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyPoint } from "@/lib/queries";

const axis = { stroke: "var(--fg-subtle)", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--fg)" },
  labelStyle: { color: "var(--fg-muted)" },
  cursor: { fill: "var(--surface-hover)" },
};

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 text-[12px] font-medium text-fg-muted">{title}</div>
      <div className="h-44">{children}</div>
    </div>
  );
}

export function AgentCharts({ data }: { data: DailyPoint[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Frame title="Runs per day">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="day" {...axis} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} {...axis} />
            <Tooltip {...tooltipStyle} />
            <Bar dataKey="success" stackId="a" fill="var(--status-success)" name="Success" />
            <Bar dataKey="failed" stackId="a" fill="var(--status-failed)" name="Failed" />
            <Bar dataKey="other" stackId="a" fill="var(--status-idle)" name="Other" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Frame>
      <Frame title="Avg duration (min)">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="day" {...axis} interval="preserveStartEnd" />
            <YAxis {...axis} />
            <Tooltip {...tooltipStyle} cursor={{ stroke: "var(--border-strong)" }} />
            <Line type="monotone" dataKey="avgDurationMin" name="Avg min" stroke="var(--status-running)" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </Frame>
      <Frame title="Est. cost per day (USD)">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="day" {...axis} interval="preserveStartEnd" />
            <YAxis {...axis} />
            <Tooltip {...tooltipStyle} formatter={(v) => `$${Number(v).toFixed(2)}`} />
            <Bar dataKey="cost" name="Cost" fill="var(--accent)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Frame>
    </div>
  );
}
