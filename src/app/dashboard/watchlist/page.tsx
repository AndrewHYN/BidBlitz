import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Bookmark, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWatchlist } from "@/server/queries";
import { AuctionCard } from "@/components/auction/auction-card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Saved items",
  description: "Find your saved marketplace listings.",
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
    <div className="space-y-5 sm:space-y-6">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Saved items</h1>

      <div data-testid="watchlist-grid">
        {items.length === 0 ? (
          <section data-testid="empty-state" className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-5 py-9 text-center shadow-sm sm:py-12">
            <div className="grid size-11 place-items-center rounded-xl bg-muted text-foreground">
              <Bookmark className="size-5" aria-hidden />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">No saved items yet</h2>
              <p className="max-w-xs text-sm leading-6 text-muted-foreground">
                Tap the bookmark on a listing to find it here later.
              </p>
            </div>
            <Button asChild variant="outline" className="min-h-11 shadow-sm">
              <Link href="/browse"><Search aria-hidden /> Browse listings</Link>
            </Button>
          </section>
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
