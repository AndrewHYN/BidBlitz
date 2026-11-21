import { ChatPresence, ChatReceipt, formatChatTime, isChatPeerOnline } from "@/components/messages/chat-status";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Pin, BellOff, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";

import type { Database } from "@/lib/supabase/types";
import { ChatRow } from "@/components/messages/chat-row";

export const metadata: Metadata = {
  title: "Messages",
  description: "Private conversations with buyers and sellers.",
  robots: { index: false, follow: false },
};

export default async function MessagesInboxPage({ searchParams }: { searchParams: Promise<{ folder?: string; page?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/messages");

  const params = await searchParams;
  const archived = params.folder === "archived";
  const page = Math.min(100000, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  const folderLink = (n: number) => `/messages?folder=${archived ? "archived" : "inbox"}&page=${n}`;
  const { data: conversations, error } = await supabase.rpc("listing_chat_inbox", { p_archived: archived, p_offset: (page - 1) * 50 });
  const threads: Database["public"]["Functions"]["listing_chat_inbox"]["Returns"] = (conversations ?? []).slice(0, 50);
  const listingIds = [...new Set(threads.map((c) => c.listing_id))];
  const otherIds = [...new Set(threads.map((c) => c.seller_id === user.id ? c.buyer_id : c.seller_id))];
  const threadIds = threads.map((c) => c.id);
  const [{ data: listings }, { data: people }, { data: presence }] =
    await Promise.all([
      listingIds.length
        ? supabase.from("auctions").select("id, title").in("id", listingIds)
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
      otherIds.length
        ? supabase.from("profiles").select("id, display_name, username, avatar_path").in("id", otherIds)
        : Promise.resolve({ data: [] as { id: string; display_name: string; username: string; avatar_path: string | null }[] }),
      threadIds.length ? supabase.rpc("listing_chat_peer_presence", { p_conversation_ids: threadIds }) : Promise.resolve({ data: [] as { conversation_id: string; last_seen_at: string }[] }),
    ]);

  const titles = new Map((listings ?? []).map((item) => [item.id, item.title]));
  const profiles = new Map((people ?? []).map((person) => [person.id, person]));
  // Snapshot the clock once per server request for presence and local dates.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const presenceByThread = new Map<string, string>((presence ?? []).map((peer: { conversation_id: string; last_seen_at: string }) => [peer.conversation_id, peer.last_seen_at]));
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

        <nav aria-label="Message folders" className="flex gap-2 border-b">
          {[{ label: "Inbox", href: "/messages", active: !archived }, { label: "Archived", href: "/messages?folder=archived", active: archived }].map(tab =>
            <Link key={tab.href} href={tab.href} aria-current={tab.active ? "page" : undefined}
              className={`px-4 py-3 text-sm font-semibold ${tab.active ? "border-b-2 border-primary" : "text-muted-foreground hover:bg-muted"}`}>{tab.label}</Link>)}
        </nav>
        {error ? (
          <div role="alert" className="rounded-xl border bg-card p-6 text-sm">
            Messages are not available yet. The marketplace messaging update may still be rolling out.
          </div>
        ) : threads.length === 0 ? (
          <div className="space-y-4 rounded-xl border bg-card p-8 text-center">
            <MessageCircle className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <h2 className="text-lg font-semibold">{archived ? "No archived chats here" : "No conversations here yet"}</h2>
            <p className="text-sm text-muted-foreground">{archived ? "Chats you archive are kept here until a new message arrives." : "When you message a seller or receive an enquiry, it will appear here."}</p>
            <Button asChild><Link href="/browse">Explore items</Link></Button>
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
            {threads.map((thread) => {
              const other = thread.seller_id === user.id ? thread.buyer_id : thread.seller_id;
              const peer = profiles.get(other);
              const lastSeen = presenceByThread.get(thread.id);
              const count = thread.unread_count;
              return (
                <ChatRow key={thread.id} id={thread.id} userId={user.id} name={peer?.display_name ?? "Marketplace member"}
                  pinned={thread.pinned} muted={thread.muted} archived={archived} leftBy={thread.left_by} unread={count > 0 || thread.manual_unread}>
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
                        {!thread.left_by && thread.last_sender === user.id && <ChatReceipt seen={Boolean(thread.last_read)} peerOnline={isChatPeerOnline(lastSeen, now)} />}
                        <span className="truncate">{thread.left_by ? thread.left_by === user.id ? "You left the chat" : "Left the chat" : thread.last_body ?? "Open conversation"}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {thread.last_at && <time dateTime={thread.last_at} className="text-xs tabular-nums text-muted-foreground">{formatChatTime(thread.last_at, now)}</time>}
                      {count > 0 && <span aria-label={`${count} unread messages`} className="rounded-md bg-primary px-2 py-1 text-xs font-bold text-primary-foreground">{count > 99 ? "99+" : count}</span>}
                      <div className="flex gap-1 text-muted-foreground">
                        {count === 0 && thread.manual_unread && <span aria-label="Marked unread" className="size-2 rounded-full bg-primary" />}
                        {thread.pinned && <Pin className="size-3.5" aria-label="Pinned" />}
                        {thread.muted && <BellOff className="size-3.5" aria-label="Muted" />}
                      </div>
                    </div>
                  </Link>
                </ChatRow>
              );
            })}
          </ul>
        )}
        {(page > 1 || (conversations?.length ?? 0) > 50) && <nav className="flex gap-4" aria-label="Message pages">
          {page > 1 && <Button asChild variant="outline"><Link href={folderLink(page - 1)}>Previous</Link></Button>}
          {(conversations?.length ?? 0) > 50 && <Button asChild variant="outline"><Link href={folderLink(page + 1)}>Next</Link></Button>}
        </nav>}
      </div>
    </div>
  );
}
