import { CopyButton } from "./actions";

export function CodeBlock({ code, title }: { code: string; title?: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-border bg-surface-2">
      <div className="flex items-center justify-between border-b border-border px-3 py-1">
        <span className="font-mono text-[11px] text-fg-subtle">{title}</span>
        <CopyButton text={code} />
      </div>
      <pre className="max-h-96 overflow-auto p-3 font-mono text-[12px] leading-relaxed text-fg-muted">{code}</pre>
    </div>
  );
}
