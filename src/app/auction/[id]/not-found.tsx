import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/auction/page-header";

/** Rendered when `notFound()` fires: missing id, or invisible to this viewer. */
export default function AuctionNotFound() {
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
