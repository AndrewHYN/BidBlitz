"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { markListingChatReadAction, sendListingChatAction } from "@/server/actions/listing-chat";

export type ListingChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

export function ListingChatThread({ conversationId, viewerId, initial }: {
  conversationId: string;
  viewerId: string;
  initial: ListingChatMessage[];
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const lastMessageId = initial.at(-1)?.id;

  // Server remains the source of truth. Polling is a free-tier fallback until
  // private realtime channels and notification delivery are verified.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = window.setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [router, conversationId]);

  useEffect(() => {
    void markListingChatReadAction(conversationId).catch(() => {});
  }, [conversationId, lastMessageId]);

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const text = body.trim();
    if (!text) return setError("Write a message first.");
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendListingChatAction({ conversationId, body: text });
        if (result.ok) {
          setBody("");
          router.refresh();
        } else setError(result.message);
      } catch {
        setError("We couldn't send your message. Try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <div className="space-y-6">
      <ol aria-label="Conversation messages" aria-live="polite" className="space-y-3">
        {initial.length === 0 && (
          <li className="rounded-lg border p-5 text-sm text-muted-foreground">
            No messages yet.
          </li>
        )}
        {initial.map((message) => {
          const mine = message.sender_id === viewerId;
          return (
            <li key={message.id} className={mine ? "flex justify-end" : "flex justify-start"}>
              <div className={mine
                ? "max-w-[85%] rounded-xl bg-primary p-3 text-sm text-primary-foreground"
                : "max-w-[85%] rounded-xl border bg-card p-3 text-sm"}>
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                <p className={mine ? "mt-1 text-right text-xs opacity-75" : "mt-1 text-right text-xs text-muted-foreground"}>
                  {new Date(message.created_at).toLocaleString("en-ZW", { dateStyle: "medium", timeStyle: "short" })}
                  {mine && message.read_at ? " · Seen" : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <form method="post" onSubmit={send} className="space-y-3">
        <label htmlFor="listing-chat-body" className="block text-sm font-medium">Reply</label>
        <Textarea
          id="listing-chat-body"
          value={body}
          onChange={(event) => setBody(event.target.value.slice(0, 2000))}
          maxLength={2000}
          rows={3}
          required
          placeholder="Write your reply…"
        />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{body.length}/2000</span>
          <Button type="submit" disabled={pending || !body.trim()} aria-busy={pending}>
            <Send className="size-4" aria-hidden /> {pending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}
