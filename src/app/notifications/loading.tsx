export default function NotificationsLoading() {
  return (
    <div
      className="page-container py-10 sm:py-14"
      role="status"
      aria-label="Loading notifications"
    >
      <div className="mb-6 h-9 w-56 animate-pulse rounded-md bg-muted" />
      <div className="mb-8 h-4 w-80 animate-pulse rounded-md bg-muted" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-14 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
