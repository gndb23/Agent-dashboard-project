export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs text-fg-subtle">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-[-0.018em] text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold text-fg">{children}</h2>
      {aside && <span className="text-xs text-fg-subtle">{aside}</span>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-border-strong bg-surface/50 px-6 py-14 text-center">
      <div className="text-base font-medium text-fg">{title}</div>
      {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-fg-muted">{children}</div>}
    </div>
  );
}
