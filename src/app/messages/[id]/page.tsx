import { ChatPresence, isChatPeerOnline } from "@/components/messages/chat-status";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { imageUrlFor } from "@/server/queries";
import { ImageWithFallback } from "@/components/auction/image-with-fallback";
import { UserAvatar } from "@/components/profile/user-avatar";
import { ArrowLeft, ChevronRight, Package, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportDialog } from "@/components/auction/report-dialog";
import { ListingChatThread, type ListingChatMessage } from "@/components/messages/listing-chat-thread";
import { MarketplaceDealPanels } from "@/components/messages/marketplace-deal-panels";
import { ListingPickupControls } from "@/components/messages/listing-pickup-controls";

export const metadata: Metadata = {
  title: "Conversation",
  description: "Private buyer and seller messages.",
  robots: { index: false, follow: false },
};

export default async function ListingConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/messages/${id}`);

  // RLS filters out conversations not belonging to this user.
  const { data: chat } = await supabase.from("listing_conversations")
    .select("id, listing_id, buyer_id, seller_id, left_by").eq("id", id).maybeSingle();
  if (!chat) notFound();

  const otherId = chat.seller_id === user.id ? chat.buyer_id : chat.seller_id;
  const [{ data: listing }, { data: person }, { data: messages }, { data: offers }, { data: hires }, { data: presence }, { data: pickup }] = await Promise.all([
    supabase.from("auctions").select("id, title, status, listing_kind, auction_images(storage_path)").eq("id", chat.listing_id)
      .order("position", { referencedTable: "auction_images" }).limit(1, { referencedTable: "auction_images" }).maybeSingle(),
    supabase.from("profiles").select("display_name, username, avatar_path").eq("id", otherId).maybeSingle(),
    supabase.from("listing_messages")
      .select("id, sender_id, body, created_at, read_at, attachment_kind")
      .eq("conversation_id", chat.id)
      .order("created_at", { ascending: false }).limit(100),
    supabase.from("listing_offers").select("id,amount_minor,status,buyer_id,seller_id,created_at")
      .eq("conversation_id", chat.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("service_requests").select("id,details,status,client_id,provider_id,created_at")
      .eq("conversation_id", chat.id).order("created_at", { ascending: false }).limit(30),
    supabase.rpc("listing_chat_peer_presence", { p_conversation_ids: [chat.id] }),
    supabase.from("listing_pickup_reservations").select("conversation_id").eq("listing_id", chat.listing_id).maybeSingle(),
  ]);
  const requestIds = (hires ?? []).map((request) => request.id);
  const { data: existingReviews } = requestIds.length
    ? await supabase.from("service_reviews").select("request_id").in("request_id", requestIds)
    : { data: [] as { request_id: string }[] };

  // Snapshot the clock once per server request for presence and local dates.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const lastSeen = presence?.[0]?.last_seen_at;
  const ordered = ([...(messages ?? [])].reverse()) as ListingChatMessage[];

  return (
    <div data-chat-screen className="chat-screen">
      <header className="flex shrink-0 items-center gap-2 border-b bg-card px-2 py-2 sm:gap-3 sm:px-5">
        <Button asChild size="icon" variant="ghost">
          <Link href="/messages" aria-label="Back to messages" title="Back to messages"><ArrowLeft aria-hidden /></Link>
        </Button>
        <UserAvatar name={person?.display_name ?? "Marketplace member"} avatarPath={person?.avatar_path} pixelSize={48} className="size-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base leading-snug font-bold">{person?.display_name ?? "Marketplace member"}</h1>
          <ChatPresence lastSeen={lastSeen} now={now} />
          {person?.username && <Link href={`/profile/${person.username}`} className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground hover:underline">View profile and reviews <ChevronRight className="size-3.5" aria-hidden /></Link>}
        </div>
        <ReportDialog compact userId={otherId} username={person?.username ?? "member"} />
      </header>
      <Link href={`/listing/${chat.listing_id}`} className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-2.5 hover:bg-muted sm:px-6">
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent text-accent-foreground">
          <ImageWithFallback src={imageUrlFor(listing?.auction_images?.[0]?.storage_path)} alt="" className="size-full object-cover" fallback={<Package className="size-4" aria-hidden />} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">{listing && listing.status !== "LISTED" ? "Listing unavailable" : "Listing"}</span>
          <span className="block truncate text-sm font-semibold">{listing?.title ?? "View item"}</span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </Link>
      {listing?.listing_kind === "SALE" && (
        <ListingPickupControls listingId={chat.listing_id} conversationId={chat.id}
          isSeller={chat.seller_id === user.id} reservedConversationId={pickup?.conversation_id ?? null}
          isListed={listing.status === "LISTED"} isSold={listing.status === "SOLD_DIRECT"} />
      )}
      <MarketplaceDealPanels viewerId={user.id} offers={offers ?? []} hires={hires ?? []}
        reviewedRequestIds={(existingReviews ?? []).map((review) => review.request_id)} />
      <ListingChatThread key={chat.id} leftBy={chat.left_by} conversationId={chat.id} viewerId={user.id} initial={ordered} peerOnline={isChatPeerOnline(lastSeen, now)}
        peerName={person?.display_name ?? "Marketplace member"} peerAvatarPath={person?.avatar_path} />
      <details className="shrink-0 border-t bg-card px-4 text-xs text-muted-foreground">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 font-medium"><ShieldCheck className="size-3.5" aria-hidden /> Trading safety</summary>
        <p className="max-h-24 overflow-y-auto pb-3 leading-relaxed">Arrange payment and pickup directly. Inspect the item before paying. Keep wallet PINs, identity documents and one-time codes private.</p>
      </details>
    </div>
  );
}
