"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addDisputeMessageAction } from "@/server/actions/disputes";

export function DisputeMessageForm({
  disputeId,
  resolved,
}: {
  disputeId: string;
  resolved: boolean;
}) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (resolved) {
    return (
      <p className="rounded-xl border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
        This case is resolved. The message and evidence history is locked as the case record.
      </p>
    );
  }

  return (
    <form
      method="post"
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = body.trim();
        if (!trimmed) return;
        setMessage(null);
        startTransition(async () => {
          const result = await addDisputeMessageAction({ disputeId, body: trimmed });
          if (result.ok) {
            setBody("");
            setMessage("Reply added to the case.");
          } else {
            setMessage(result.message);
          }
        });
      }}
    >
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        maxLength={3000}
        placeholder="Add facts, an update, or a response to the case…"
        disabled={pending}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Replies become part of the permanent case timeline.</p>
        <Button type="submit" disabled={pending || body.trim().length === 0}>
          <Send className="size-4" aria-hidden />
          {pending ? "Adding reply…" : "Add reply"}
        </Button>
      </div>
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </form>
  );
}
