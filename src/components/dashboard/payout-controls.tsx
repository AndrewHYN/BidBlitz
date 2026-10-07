"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sellerPayoutAction } from "@/components/dashboard/admin-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/auction/money";
import type { SellerPayoutStatus } from "@/lib/supabase/types";

/**
 * Payout operations for one seller payout.
 *
 * Every button here is a request, never an outcome: the row only changes when
 * `admin_transition_seller_payout()` accepts it, and the page re-reads from
 * Postgres afterwards so the badge can never drift from the database. The
 * database also refuses anything outside the fulfilment map, so a stale UI
 * showing an illegal action produces an honest error instead of a wrong state.
 */

/** What each status is allowed to move to. Mirrors the SQL transition map. */
const NEXT_ACTIONS: Record<SellerPayoutStatus, SellerPayoutStatus[]> = {
  WAITING_FOR_FULFILMENT: ["DELIVERY_CONFIRMED", "HELD", "DISPUTED"],
  DELIVERY_CONFIRMED: ["PAYOUT_PENDING", "PAYOUT_DUE", "HELD", "DISPUTED"],
  PAYOUT_PENDING: ["DELIVERY_CONFIRMED", "PAYOUT_DUE", "HELD", "DISPUTED"],
  PAYOUT_DUE: ["PAID_OUT", "HELD", "DISPUTED"],
  HELD: [
    "WAITING_FOR_FULFILMENT",
    "DELIVERY_CONFIRMED",
    "PAYOUT_PENDING",
    "PAYOUT_DUE",
    "DISPUTED",
  ],
  DISPUTED: [
    "WAITING_FOR_FULFILMENT",
    "DELIVERY_CONFIRMED",
    "PAYOUT_PENDING",
    "PAYOUT_DUE",
    "HELD",
  ],
  PAID_OUT: [],
};

const ACTION_LABELS: Record<SellerPayoutStatus, string> = {
  WAITING_FOR_FULFILMENT: "Restart fulfilment",
  DELIVERY_CONFIRMED: "Mark delivery confirmed",
  PAYOUT_PENDING: "Mark payout pending",
  PAYOUT_DUE: "Mark payout due",
  PAID_OUT: "Record seller payout",
  HELD: "Hold payout",
  DISPUTED: "Record dispute",
};

/** Only `PAID_OUT` records money leaving the platform — it is irreversible. */
const IRREVERSIBLE: SellerPayoutStatus[] = ["PAID_OUT"];

function confirmCopy(to: SellerPayoutStatus, amountMinor: number, currency: string) {
  switch (to) {
    case "PAID_OUT":
      return (
        <>
          Record this payout of <Money minor={amountMinor} currency={currency} /> as
          already paid to the seller outside the normal automatic Linkwa flow?
          Use this only for a verified reconciliation or external transfer.
          It cannot be undone.
        </>
      );
    case "HELD":
      return "Hold this payout? The seller stays unpaid until it is released.";
    case "DISPUTED":
      return "Record a dispute on this payout? It stays blocked until the dispute is resolved.";
    default:
      return `Move this payout to “${ACTION_LABELS[to]}”?`;
  }
}

export function PayoutControls({
  payoutId,
  status,
  amountMinor,
  currency,
  deliveryConfirmedAt,
}: {
  payoutId: string;
  status: SellerPayoutStatus;
  amountMinor: number;
  currency: string;
  /** The database refuses any move into PAYOUT_DUE until this is set. */
  deliveryConfirmedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SellerPayoutStatus | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  // Mirrors the SQL transition map, minus the one option the delivery
  // invariant can refuse: "Mark payout due" is only offered once delivery is
  // an explicit fact, so the console never offers an action the database
  // rejects with `payout_delivery_not_confirmed`. The database stays the
  // authority either way.
  const actions = (NEXT_ACTIONS[status] ?? []).filter(
    (to) => to !== "PAYOUT_DUE" || Boolean(deliveryConfirmedAt)
  );

  function run(to: SellerPayoutStatus) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await sellerPayoutAction({
          payoutId,
          status: to,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setConfirming(null);
        setReference("");
        setNote("");
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  if (confirming) {
    const needsReference = confirming === "PAID_OUT";
    const blocked = pending || (needsReference && reference.trim().length === 0);

    return (
      <div
        role="group"
        aria-label="Confirm payout update"
        data-testid="payout-confirm-panel"
        className="space-y-3 rounded-lg border bg-muted/40 p-3"
      >
        <p className="text-xs leading-relaxed">
          {confirmCopy(confirming, amountMinor, currency)}
        </p>

        {needsReference && (
          <div className="space-y-1.5">
            <label
              htmlFor={`payout-ref-${payoutId}`}
              className="text-xs font-medium"
            >
              Payout reference
            </label>
            <Input
              id={`payout-ref-${payoutId}`}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Bank transfer reference"
              maxLength={200}
              autoComplete="off"
              data-testid="payout-reference"
            />
            <p className="text-xs text-muted-foreground">
              Required. Use the exact external transfer or reconciliation reference.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor={`payout-note-${payoutId}`} className="text-xs font-medium">
            Internal note <span className="text-muted-foreground">(optional)</span>
          </label>
          <Input
            id={`payout-note-${payoutId}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="For your own records"
            maxLength={500}
            autoComplete="off"
            data-testid="payout-note"
          />
        </div>

        {error && (
          <p role="alert" data-testid="payout-error" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={blocked}
            aria-busy={pending}
            onClick={() => run(confirming)}
            data-testid="payout-confirm"
          >
            {pending ? "Saving…" : `Confirm ${ACTION_LABELS[confirming].toLowerCase()}`}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setConfirming(null);
              setError(null);
            }}
            data-testid="payout-cancel"
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (actions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="payout-final">
        Paid out and closed. This record can no longer be changed.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((to) => (
          <Button
            key={to}
            type="button"
            size="sm"
            variant={to === "PAID_OUT" ? "default" : "outline"}
            disabled={pending}
            onClick={() => {
              setError(null);
              // Irreversible states always go through the confirmation panel;
              // the rest confirm inline in one click so triage stays fast.
              if (IRREVERSIBLE.includes(to) || to === "HELD" || to === "DISPUTED") {
                setConfirming(to);
              } else {
                run(to);
              }
            }}
            data-testid={`payout-action-${to.toLowerCase()}`}
          >
            {ACTION_LABELS[to]}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" data-testid="payout-error" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
