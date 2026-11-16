"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-card border border-status-failed/40 bg-status-failed/8 p-6">
      <div className="text-[14px] font-semibold text-status-failed">Something went wrong</div>
      <pre className="mt-2 whitespace-pre-wrap font-mono text-[12px] text-fg-muted">{error.message}</pre>
      <button onClick={reset} className="mt-3 text-[13px] text-accent hover:underline cursor-pointer">Try again</button>
    </div>
  );
}
