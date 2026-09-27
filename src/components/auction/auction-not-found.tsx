import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/auction/page-header";

/**
 * The auction-specific not-found UI.
 *
 * Served by `app/auction/[id]/not-found.tsx` when the page itself throws
 * `notFound()` — the fail-open path where `src/proxy.ts` could not check
 * existence (infrastructure error) and the page ran its own lookup. The
 * normal confirmed-missing path never gets here: the proxy rewrites it onto
 * the router-level not-found (see proxy.ts), which streams faster but has no
 * per-segment boundary. Keeping this UI is what makes that fail-open path
 * still explain exactly what happened instead of showing a generic 404.
 */
export function AuctionNotFound() {
  return (
    <div className="page-container py-16">
      <EmptyState
        icon={SearchX}
        title="Auction not found"
        description="This auction doesn't exist, was removed, or isn't visible to you right now."
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild>
              <Link href="/browse">Browse auctions</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Back to home</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
