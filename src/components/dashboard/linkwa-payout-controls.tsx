"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { initiateLinkwaPayoutAction } from "@/server/actions/linkwa-payouts";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/auction/money";

/**
 * The explicit, confirmed "send the seller's net through Linkwa" action.
 *
 * One click opens the confirmation, a second sends exactly one request with
 * only the payout id. Amount, recipient and provider are derived server-side;
 * the browser never controls them. The payout is NOT sent when Linkwa is not
 * configured, no recipient is on file, or the payment is not payable - the
 * action refuses and the message says why.
 */
export function LinkwaPayoutControls({
  payoutId,
  amountMinor,
  currency,
  sellerName,
  recipientOnFile,
}: {
  payoutId: string;
  amountMinor: number;
  currency: string;
  sellerName: string;
  recipientOnFile: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (reference) {
    return (
      <p role="status" data-testid="linkwa-payout-success" className="text-xs text-foreground">
        Linkwa accepted the payout. Reference: <code>{reference}</code>. Confirm
        settlement in the Linkwa statement/balance - Linkwa documents no payout
        status endpoint.
      </p>
    );
  }

  if (!recipientOnFile) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="linkwa-payout-no-recipient">
        No Linkwa payout recipient is on file for this seller, so no payout can
        be sent from here yet.
      </p>
    );
  }

  if (confirming) {
    return (
      <div
        role="group"
        aria-label="Confirm Linkwa payout"
        data-testid="linkwa-payout-confirm-panel"
        className="space-y-3 rounded-lg border bg-muted/40 p-3"
      >
        <p className="text-xs leading-relaxed">
          Send exactly <Money minor={amountMinor} currency={currency} /> to{" "}
          <strong>{sellerName}</strong>&apos;s registered Linkwa payout
          recipient? This moves real money. It cannot be recalled, and a second
          payout for this sale is refused by the ledger. Only do this when the
          sale is fulfilled and the payout shows as payout pending.
        </p>
        {error && (
          <p role="alert" data-testid="linkwa-payout-error" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            aria-busy={pending}
            data-testid="linkwa-payout-confirm"
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  const result = await initiateLinkwaPayoutAction({ payoutId });
                  if (!result.ok) {
                    setError(result.message);
                    return;
                  }
                  setConfirming(false);
                  setReference(result.payoutReference);
                  router.refresh();
                } catch {
                  setError("Something went wrong. Please try again.");
                }
              });
            }}
          >
            {pending ? "Sending…" : "Send payout with Linkwa"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            data-testid="linkwa-payout-cancel"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        data-testid="linkwa-payout-start"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Pay seller with Linkwa
      </Button>
      {error && (
        <p role="alert" data-testid="linkwa-payout-error" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
