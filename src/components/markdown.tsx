"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders assistant replies (Markdown) with the dashboard's styles. Links open in a new tab. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md text-sm leading-relaxed text-fg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target={href?.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
              {children}
            </a>
          ),
          code: ({ className, children }) =>
            className ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
            ),
          pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-control border border-border bg-bg p-3 font-mono text-xs">{children}</pre>,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-border px-2 py-1 text-left font-semibold text-fg-muted">{children}</th>,
          td: ({ children }) => <td className="border-b border-border px-2 py-1 align-top">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
