"use client";

import { useState, useTransition } from "react";
import { CircleCheck, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmDeliveryAction } from "@/server/actions/delivery";

export function ConfirmDeliveryButton({
  transactionId,
  confirmed,
}: {
  transactionId: string;
  confirmed: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(confirmed);
  const [message, setMessage] = useState<string | null>(null);

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
        <CircleCheck className="size-3.5" aria-hidden />
        Handover confirmed
      </span>
    );
  }

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Confirm you received the item and are satisfied with the handover? This makes the seller's proceeds eligible for Finance to process; receipt of money is verified separately.")) {
            return;
          }
          setMessage(null);
          startTransition(async () => {
            const result = await confirmDeliveryAction({ transactionId });
            setMessage(result.message);
            if (result.ok) setDone(true);
          });
        }}
      >
        <PackageCheck className="size-4" aria-hidden />
        {pending ? "Confirming…" : "Confirm handover"}
      </Button>
      {message && (
        <p role="status" className="max-w-xs text-xs leading-5 text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
