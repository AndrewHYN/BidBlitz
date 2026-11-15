import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuctionDetail } from "@/server/queries";
import { StartListingChat } from "@/components/messages/start-listing-chat";

export const metadata: Metadata = {
  title: "Message seller",
  description: "Ask a seller about a listing in a private conversation.",
  robots: { index: false, follow: false },
};

export default async function NewListingChatPage({
  searchParams,
}: {
  searchParams: Promise<{ listing?: string }>;
}) {
  const { listing } = await searchParams;
  if (!listing || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listing)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/messages/new?listing=${listing}`);

  const detail = await getAuctionDetail(listing);
  if (!detail || !detail.auction.is_direct || detail.auction.status !== "LISTED") notFound();
  if (detail.auction.seller_id === user.id) redirect(`/sell/${listing}`);

  return (
    <div className="page-container pt-8 pb-32 sm:py-14">
      <div className="mx-auto max-w-xl space-y-6">
        <Link href={`/auction/${listing}`} className="text-sm font-medium text-primary hover:underline">Back to listing</Link>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Message the seller</h1>
          <p className="text-sm text-muted-foreground">
            Ask about <strong>{detail.auction.title}</strong> without leaving BidBlitz.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-5 sm:p-7">
          <StartListingChat
            listingId={listing}
            sellerName={detail.auction.seller?.display_name ?? "seller"}
          />
        </div>
      </div>
    </div>
  );
}
