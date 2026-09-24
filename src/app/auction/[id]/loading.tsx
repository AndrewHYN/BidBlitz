import { Skeleton } from "@/components/ui/skeleton";

/**
 * Auction detail loading fallback — mirrors the two-column layout (media left,
 * title + bid panel right) over the description and bid-history rows, so the
 * page lands in roughly the shape it will fill into.
 */
export default function AuctionLoading() {
  return (
    <div
      role="status"
      aria-label="Loading auction"
      className="page-container py-10 sm:py-14"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Skeleton className="aspect-[4/3] w-full rounded-xl" />

        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>

          <div className="space-y-3 rounded-xl border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-10 w-44" />
            </div>
            <div className="flex items-end justify-between gap-4">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-9 w-full" />
          </div>

          <Skeleton className="h-9 w-36" />
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <div className="space-y-3 rounded-xl border bg-card p-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>

          <div className="space-y-4">
            <Skeleton className="h-5 w-36" />
            <div className="space-y-2 rounded-xl border bg-card p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4 self-start rounded-xl border bg-card p-5">
          <Skeleton className="h-5 w-32" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
