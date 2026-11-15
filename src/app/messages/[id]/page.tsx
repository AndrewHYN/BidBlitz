import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ListingChatThread, type ListingChatMessage } from "@/components/messages/listing-chat-thread";

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
    .select("id, listing_id, buyer_id, seller_id").eq("id", id).maybeSingle();
  if (!chat) notFound();

  const otherId = chat.seller_id === user.id ? chat.buyer_id : chat.seller_id;
  const [{ data: listing }, { data: person }, { data: messages }] = await Promise.all([
    supabase.from("auctions").select("id, title, status").eq("id", chat.listing_id).maybeSingle(),
    supabase.from("profiles").select("display_name").eq("id", otherId).maybeSingle(),
    supabase.from("listing_messages")
      .select("id, sender_id, body, created_at, read_at")
      .eq("conversation_id", chat.id)
      .order("created_at", { ascending: false }).limit(100),
  ]);

  const ordered = ([...(messages ?? [])].reverse()) as ListingChatMessage[];

  return (
    <div className="page-container py-10 sm:py-14">
      <div className="mx-auto max-w-2xl space-y-5">
        <Link href="/messages" className="text-sm font-medium text-primary hover:underline">Back to messages</Link>
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{person?.display_name ?? "Marketplace member"}</h1>
          <p className="text-sm text-muted-foreground">
            Discussing{" "}
            <Link href={`/auction/${chat.listing_id}`} className="font-medium text-primary underline underline-offset-2">
              {listing?.title ?? "an item"}
            </Link>
            {listing && listing.status !== "LISTED" ? " · Item no longer listed" : ""}
          </p>
        </header>
        <div className="rounded-xl border bg-card p-4 sm:p-6">
          <ListingChatThread conversationId={chat.id} viewerId={user.id} initial={ordered} />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Payments and pickup are arranged directly between you and the seller. Inspect goods in person where possible.
          Never share wallet PINs, identity documents or one-time codes.
        </p>
      </div>
    </div>
  );
}
