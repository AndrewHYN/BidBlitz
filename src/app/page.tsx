import { Gavel } from "lucide-react";
import { PageHeader } from "@/components/auction/page-header";

/**
 * Landing page. Replaced by the real home experience; this keeps the route
 * valid while pages are built out.
 */
export default function HomePage() {
  return (
    <div className="page-container py-16">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Gavel className="size-6 text-primary" /> BidBlitz
          </span>
        }
        description="Live competitive auctions. Server-authoritative bidding, anti-snipe protection, honest settlement."
      />
      <p className="mt-6 text-sm text-muted-foreground">Loading auctions…</p>
    </div>
  );
}
