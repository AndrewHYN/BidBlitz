"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle, X } from "lucide-react";
import { toast } from "sonner";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("bidblitz-bubble", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("bidblitz-bubble", listener);
  };
}

export function useChatBubble(userId: string) {
  const key = `bidblitz-chat-bubble:${userId}`;
  const id = useSyncExternalStore(subscribe, () => {
    try { return localStorage.getItem(key); } catch { return null; }
  }, () => null);
  function save(next: string | null) {
    try {
      if (next) localStorage.setItem(key, next);
      else localStorage.removeItem(key);
      window.dispatchEvent(new Event("bidblitz-bubble"));
      return true;
    } catch {
      toast.error("This browser could not save your chat bubble.");
      return false;
    }
  }
  return { id, save };
}

export function ChatBubble({ userId }: { userId: string }) {
  const bubble = useChatBubble(userId);
  const pathname = usePathname();
  if (!bubble.id || pathname.startsWith("/messages/") || !/^[\da-f-]{36}$/i.test(bubble.id)) return null;
  return (
    <aside aria-label="Chat bubble" className="fixed right-4 bottom-28 z-40 flex items-center gap-1 rounded-full border bg-card p-1 shadow-lg lg:bottom-6">
      <Link href={`/messages/${bubble.id}`} aria-label="Open selected chat" title="Open selected chat"
        className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground"><MessageCircle aria-hidden /></Link>
      <button type="button" aria-label="Dismiss chat bubble" onClick={() => bubble.save(null)}
        className="grid size-11 cursor-pointer place-items-center rounded-full hover:bg-muted"><X className="size-4" aria-hidden /></button>
    </aside>
  );
}
