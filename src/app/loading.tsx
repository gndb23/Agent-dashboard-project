export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-7 w-48 rounded bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 rounded-card bg-surface-2" />
        ))}
      </div>
      <div className="h-64 rounded-card bg-surface-2" />
    </div>
  );
}
