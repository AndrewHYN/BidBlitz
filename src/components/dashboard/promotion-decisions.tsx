"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { decidePromotionAction } from "@/server/actions/promotion";

export function PromotionDecisions({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function decide(approve: boolean) {
    setMessage(null);
    startTransition(async () => {
      const result = await decidePromotionAction({
        requestId,
        approve,
        note: note.trim() || undefined,
      });
      setMessage(result.ok ? (approve ? "Promotion activated." : "Promotion rejected.") : result.message);
    });
  }

  return (
    <div className="space-y-3">
      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        maxLength={1000}
        disabled={pending}
        placeholder="Optional internal note or seller-facing rejection reason"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => decide(true)}>
          <Check className="size-4" aria-hidden />
          Approve promotion
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide(false)}>
          <X className="size-4" aria-hidden />
          Reject
        </Button>
      </div>
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
