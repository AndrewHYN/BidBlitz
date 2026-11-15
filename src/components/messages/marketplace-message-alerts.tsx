"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
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
          toast("New marketplace message", {
            description: `Someone messaged you about ${title}.`,
            action: { label: "Open chat", onClick: () => router.push(url) },
          });
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

  return null;
}
