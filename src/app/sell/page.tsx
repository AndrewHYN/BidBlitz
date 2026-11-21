import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCategories } from "@/server/queries";
import { PageHeader } from "@/components/auction/page-header";
import { ListingTypeChooser } from "@/components/sell/listing-type-chooser";
import { marketplaceLocation } from "@/lib/marketplace-location";

export const metadata: Metadata = {
  title: "Sell an item",
  description: "Choose Sale, Auction or Service and post your listing.",
  robots: { index: false, follow: false },
};

export default async function SellPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/sell");

  const [categories, { data: profile }] = await Promise.all([
    getCategories(),
    supabase.from("profiles").select("is_banned").eq("id", user.id).maybeSingle(),
  ]);

  return (
    <div className="page-container pb-36 pt-5 sm:pb-20 sm:pt-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 space-y-2 sm:mb-7">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Sell on BidBlitz</p>
          <PageHeader
            className="gap-1 border-0 pb-0"
            title="Create a listing"
            description="Find your category in seconds, set your price and get paid directly by your buyer or client. Add photos before publishing."
          />
        </div>
        {profile?.is_banned ? (
          <p role="alert">Your account can’t publish listings right now. <a className="underline" href="/help">Contact support</a>.</p>
        ) : categories.length === 0 ? (
          <p role="alert">We couldn’t load listing categories. Refresh the page to try again.</p>
        ) : (
          <ListingTypeChooser categories={categories} defaultLocation={marketplaceLocation(user.user_metadata.marketplace_location)} />
        )}
      </div>
    </div>
  );
}
