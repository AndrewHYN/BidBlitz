import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWatchlist } from "@/server/queries";
import { AuctionCard } from "@/components/auction/auction-card";
import { EmptyState, PageHeader } from "@/components/auction/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Watchlist",
  description: "Auctions you are keeping an eye on.",
  robots: { index: false, follow: false },
};

export default async function WatchlistPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/watchlist");

  const items = await getWatchlist(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Watchlist"
        description="Auctions you’re keeping an eye on."
      />

      <div data-testid="watchlist-grid">
        {items.length === 0 ? (
          <EmptyState
            icon={Eye}
            title="Nothing on your watchlist"
            description="Tap the watch button on any auction and it will show up here."
            action={
              <Button asChild>
                <Link href="/browse">Browse auctions</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <li key={item.id}>
                <AuctionCard auction={item} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
