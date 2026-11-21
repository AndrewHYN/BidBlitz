import { ChatPresence, ChatReceipt, formatChatTime, isChatPeerOnline } from "@/components/messages/chat-status";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Messages",
  description: "Private conversations with buyers and sellers.",
  robots: { index: false, follow: false },
};

export default async function MessagesInboxPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/messages");

  const { data: conversations, error } = await supabase
    .from("listing_conversations")
    .select("id, listing_id, seller_id, buyer_id, last_message_at")
    .order("last_message_at", { ascending: false })
    .limit(100);

  const threads = conversations ?? [];
  const listingIds = [...new Set(threads.map((c) => c.listing_id))];
  const otherIds = [...new Set(threads.map((c) => c.seller_id === user.id ? c.buyer_id : c.seller_id))];
  const threadIds = threads.map((c) => c.id);
  const [{ data: listings }, { data: people }, { data: recentMessages }, { data: unread }, { data: presence }] =
    await Promise.all([
      listingIds.length
        ? supabase.from("auctions").select("id, title").in("id", listingIds)
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
      otherIds.length
        ? supabase.from("profiles").select("id, display_name, username, avatar_path").in("id", otherIds)
        : Promise.resolve({ data: [] as { id: string; display_name: string; username: string; avatar_path: string | null }[] }),
      threadIds.length
        ? supabase.from("listing_messages")
          .select("conversation_id, body, created_at, sender_id, read_at")
          .in("conversation_id", threadIds)
          .order("created_at", { ascending: false })
          .limit(200)
        : Promise.resolve({ data: [] as { conversation_id: string; body: string; created_at: string; sender_id: string; read_at: string | null }[] }),
      threadIds.length
        ? supabase.from("listing_messages")
          .select("conversation_id")
          .in("conversation_id", threadIds)
          .neq("sender_id", user.id)
          .is("read_at", null)
        : Promise.resolve({ data: [] as { conversation_id: string }[] }),
      threadIds.length ? supabase.rpc("listing_chat_peer_presence", { p_conversation_ids: threadIds }) : Promise.resolve({ data: [] as { conversation_id: string; last_seen_at: string }[] }),
    ]);

  const titles = new Map((listings ?? []).map((item) => [item.id, item.title]));
  const profiles = new Map((people ?? []).map((person) => [person.id, person]));
  const now = Date.now();
  const presenceByThread = new Map<string, string>((presence ?? []).map((peer: { conversation_id: string; last_seen_at: string }) => [peer.conversation_id, peer.last_seen_at]));
  const latest = new Map<string, NonNullable<typeof recentMessages>[number]>();
  for (const message of recentMessages ?? []) {
    if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, message);
  }
  const unreadCounts = new Map<string, number>();
  for (const message of unread ?? []) {
    unreadCounts.set(message.conversation_id, (unreadCounts.get(message.conversation_id) ?? 0) + 1);
  }

  return (
    <div className="page-container py-8 sm:py-14">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Messages</h1>
            <p className="mt-2 text-sm text-muted-foreground">Private conversations about your items and enquiries.</p>
          </div>
          <Button asChild variant="outline"><Link href="/browse">Browse listings</Link></Button>
        </header>

        {error ? (
          <div role="alert" className="rounded-xl border bg-card p-6 text-sm">
            Messages are not available yet. The marketplace messaging update may still be rolling out.
          </div>
        ) : threads.length === 0 ? (
          <div className="space-y-4 rounded-xl border bg-card p-8 text-center">
            <MessageCircle className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <h2 className="text-lg font-semibold">No conversations yet</h2>
            <p className="text-sm text-muted-foreground">When you message a seller or receive an enquiry, it will appear here.</p>
            <Button asChild><Link href="/browse">Explore items</Link></Button>
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
            {threads.map((thread) => {
              const other = thread.seller_id === user.id ? thread.buyer_id : thread.seller_id;
              const peer = profiles.get(other);
              const lastSeen = presenceByThread.get(thread.id);
              const preview = latest.get(thread.id);
              const count = unreadCounts.get(thread.id) ?? 0;
              return (
                <li key={thread.id} className="flex items-center gap-3 px-4 hover:bg-muted/40">
                  {peer?.username && (
                    <Link href={`/profile/${peer.username}`} aria-label={`View ${peer.display_name}’s profile`} className="relative shrink-0 rounded-full focus-visible:outline-2">
                      <UserAvatar name={peer.display_name} avatarPath={peer.avatar_path} pixelSize={48} className="size-11" />
                      <ChatPresence lastSeen={lastSeen} now={now} compact />
                    </Link>
                  )}
                  <Link href={`/messages/${thread.id}`}
                    className="flex min-h-20 min-w-0 flex-1 items-center justify-between gap-2 py-4 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate font-semibold">{peer?.display_name ?? "Marketplace member"}</p>
                      <p className="text-sm text-muted-foreground">
                        {titles.get(thread.listing_id) ?? "Listing"} · {thread.seller_id === user.id ? "Selling" : "Buying"}
                      </p>
                      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        {preview?.sender_id === user.id && <ChatReceipt seen={Boolean(preview.read_at)} peerOnline={isChatPeerOnline(lastSeen, now)} />}
                        <span className="truncate">{preview?.body ?? "Open conversation"}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {preview && <time dateTime={preview.created_at} className="text-xs tabular-nums text-muted-foreground">{formatChatTime(preview.created_at, now)}</time>}
                      {count > 0 && <span aria-label={`${count} unread messages`} className="rounded-md bg-primary px-2 py-1 text-xs font-bold text-primary-foreground">{count > 99 ? "99+" : count}</span>}
                      <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
