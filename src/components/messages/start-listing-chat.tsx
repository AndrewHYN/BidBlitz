"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { startListingChatAction } from "@/server/actions/listing-chat";

export function StartListingChat({ listingId, sellerName }: { listingId: string; sellerName: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return setError("Write a message first.");
    setError(null);
    startTransition(async () => {
      try {
        const result = await startListingChatAction({ listingId, body: text });
        if (result.ok) router.push(`/messages/${result.conversationId}`);
        else setError(result.message);
      } catch {
        setError("We couldn't start this conversation. Try again.");
      }
    });
  }

  return (
    <form method="post" onSubmit={submit} className="space-y-4" data-testid="listing-chat-start">
      <label htmlFor="first-listing-message" className="block text-sm font-medium">
        Your message to {sellerName}
      </label>
      <Textarea
        id="first-listing-message"
        value={body}
        onChange={(event) => setBody(event.target.value.slice(0, 2000))}
        maxLength={2000}
        minLength={1}
        rows={5}
        placeholder="Hi! Is this item still available? Could we arrange a viewing?"
        required
      />
      <p className="text-xs text-muted-foreground">
        Only you and the seller can read your conversation. Never share a payment PIN or one-time code.
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending || !body.trim()} className="min-h-11">
        <MessageCircle className="size-4" aria-hidden /> {pending ? "Starting…" : "Send message"}
      </Button>
    </form>
  );
}
