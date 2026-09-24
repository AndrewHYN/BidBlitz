export default function DashboardLoading() {
  return (
    <div className="page-container py-10 sm:py-14" role="status" aria-label="Loading dashboard">
      <div className="mb-6 h-9 w-56 animate-pulse rounded-md bg-muted" />
      <div className="mb-10 h-4 w-80 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
      <div className="mt-10 space-y-4">
        <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-32 animate-pulse rounded-xl border bg-card" />
        <div className="h-5 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-32 animate-pulse rounded-xl border bg-card" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
