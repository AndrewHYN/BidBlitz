import { Skeleton } from "@/components/ui/skeleton";

/**
 * Global loading fallback. Mirrors the app shell's usual page shape — a page
 * header / hero block over a card grid — so navigation feels instant instead
 * of blank.
 */
export default function Loading() {
  return (
    <div
      data-testid="page-loading"
      role="status"
      aria-label="Loading page"
      className="page-container py-10 sm:py-14"
    >
      {/* page header / hero */}
      <div className="space-y-3">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      {/* section heading + action */}
      <div className="mt-8 flex items-end justify-between gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-28" />
      </div>

      {/* card grid */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
            <Skeleton className="aspect-[4/3] w-full rounded-lg" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
