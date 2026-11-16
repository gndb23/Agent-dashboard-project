import Link from "next/link";
import type { RunView } from "@/lib/queries";
import { compact, dateTime, duration, timeAgo, usd } from "@/lib/format";
import { Table, TBody, TD, TH, THead, TR } from "./ui/table";
import { RunStatusBadge } from "./status";

export function RunsTable({ runs, now, agentNames }: { runs: RunView[]; now: number; agentNames?: Map<string, string> }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Status</TH>
          {agentNames && <TH>Agent</TH>}
          <TH>Run</TH>
          <TH>Started</TH>
          <TH className="text-right">Duration</TH>
          <TH className="text-right">Tools</TH>
          <TH className="text-right">Errors</TH>
          <TH className="text-right">Tokens</TH>
          <TH className="text-right">Cost</TH>
        </tr>
      </THead>
      <TBody>
        {runs.map((r) => (
          <TR key={r.id}>
            <TD>
              <RunStatusBadge status={r.status} stalled={r.stalled} />
            </TD>
            {agentNames && (
              <TD className="whitespace-nowrap">
                <Link href={`/agents/${encodeURIComponent(r.agentId)}`} className="text-fg hover:text-accent">{agentNames.get(r.agentId) ?? r.agentId}</Link>
              </TD>
            )}
            <TD className="max-w-[340px]">
              <Link href={`/runs/${encodeURIComponent(r.id)}`} className="block truncate text-fg hover:text-accent">
                {r.title ?? <span className="font-mono text-xs">{r.id}</span>}
              </Link>
            </TD>
            <TD className="whitespace-nowrap tabular" title={dateTime(r.startedAt)}>{timeAgo(r.startedAt, now)}</TD>
            <TD className="text-right tabular">{duration(r.durationMs ?? (r.status === "running" ? now - r.startedAt : null))}</TD>
            <TD className="text-right tabular">{r.toolCount}</TD>
            <TD className={"text-right tabular" + (r.errorCount ? " text-status-failed-fg" : "")}>{r.errorCount}</TD>
            <TD className="text-right tabular">{compact(r.tokensIn + r.tokensOut)}</TD>
            <TD className="text-right tabular">{usd(r.costUsd)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
