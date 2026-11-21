"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChatBubble } from "./chat-bubble";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

let alertSequence = 0;

/**
 * Foreground notifications: the message trigger writes a normal notifications row,
 * then Realtime wakes every signed-in tab without exposing a message body.
 * Browser OS notifications only work after the user opts in, and while a tab is open.
 */
export function MarketplaceMessageAlerts({ userId }: { userId: string }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    let lastAttempt = 0;
    const heartbeat = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastAttempt < 45_000) return;
      lastAttempt = Date.now();
      void Promise.resolve(supabase.rpc("touch_marketplace_presence", {})).catch(() => {});
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 60_000);
    document.addEventListener("visibilitychange", heartbeat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", heartbeat);
    };
  }, [userId]);

  useEffect(() => {
    if (pathname !== "/messages") return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [pathname, router]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`marketplace-alerts:${userId}:${++alertSequence}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}`,
      }, ({ new: row }) => {
        if (row.type !== "NEW_MESSAGE") return;
        const data = row.payload;
        if (!data || typeof data !== "object" || !("listingChatId" in data)) return;
        const conversationId = data.listingChatId;
        if (typeof conversationId !== "string") return;
        const title = typeof data.title === "string" ? data.title : "your listing";
        const url = `/messages/${conversationId}`;
        if (pathname !== url) {
          toast(
            <Link href={url} onClick={() => toast.dismiss(row.id)}
              className="flex items-center gap-3 rounded-lg p-1 focus-visible:ring-2">
              <MessageCircle aria-hidden className="size-5 shrink-0 text-blue-600 dark:text-blue-400" />
              <span><strong className="block">New marketplace message</strong>
                <span className="text-sm font-normal">New enquiry about {title}</span></span>
            </Link>, { id: row.id }
          );
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            if ("serviceWorker" in navigator) {
              void navigator.serviceWorker.register("/message-alert-sw.js").then((registration) =>
                registration.showNotification("New BidBlitz message", {
                  body: `New enquiry about ${title}`,
                  tag: `listing-chat-${conversationId}`,
                  data: { url },
                })
              ).catch(() => {
                // The in-app toast remains available when mobile OS alerts are blocked.
              });
            } else {
              try {
                const alert = new Notification("New BidBlitz message", {
                  body: `New enquiry about ${title}`,
                  tag: `listing-chat-${conversationId}`,
                });
                alert.onclick = () => { window.focus(); router.push(url); alert.close(); };
              } catch {
                // No OS notification support: retain the in-app alert.
              }
            }
          }
        }
        router.refresh();
      })
      .subscribe();
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [userId, pathname, router]);

  return <ChatBubble userId={userId} />;
}
