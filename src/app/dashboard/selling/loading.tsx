export default function SellingLoading() {
  return (
    <div className="page-container py-10 sm:py-14" role="status" aria-label="Loading selling">
      <div className="mb-6 h-9 w-44 animate-pulse rounded-md bg-muted" />
      <div className="mb-8 h-4 w-72 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-56 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
