import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCategories } from "@/server/queries";
import { PageHeader } from "@/components/auction/page-header";
import { ListingTypeChooser } from "@/components/sell/listing-type-chooser";

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
    <div className="page-container py-10 sm:py-14">
      <PageHeader
        title="Create a listing"
        description="Choose an item sale, an auction or a service. For direct listings, get paid directly by your buyer or client; auctions follow separate bidding rules."
      />
      <div className="mt-6 max-w-4xl">
        {profile?.is_banned ? (
          <p role="alert">Your account can’t publish listings right now. <a className="underline" href="/help">Contact support</a>.</p>
        ) : categories.length === 0 ? (
          <p role="alert">We couldn’t load listing categories. Refresh the page to try again.</p>
        ) : (
          <ListingTypeChooser categories={categories} />
        )}
      </div>
    </div>
  );
}
