export default function NotificationsLoading() {
  return (
    <div className="notification-inbox" role="status" aria-label="Loading notifications">
      <div className="notification-header"><div className="h-9 w-48 animate-pulse rounded bg-muted" /></div>
      <div className="notification-feed divide-y divide-border" aria-hidden>
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="notification-row-content animate-pulse">
            <span className="notification-photo" />
            <span className="space-y-2"><span className="block h-3 w-16 rounded bg-muted" />
              <span className="block h-4 w-3/4 rounded bg-muted" /></span>
          </div>
        ))}
      </div>
    </div>
  );
}
