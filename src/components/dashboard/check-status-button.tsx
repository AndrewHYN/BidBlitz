"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Explicit payment-status reconciliation for one transaction.
 *
 * What it is NOT: a claim that the payment happened. It asks the server to
 * check the provider's own status endpoint server-side and then re-read the
 * row, so the page converges on what Postgres says. The browser contributes
 * nothing but the transaction id — a status field in the request body is
 * ignored by the route, and this component never sends one.
 *
 * It exists because Paynow's status update (the primary signal) was not
 * observed arriving; a buyer who has paid must still be able to find out, and
 * a seller must be able to see the same thing, without anyone guessing.
 */
export function CheckStatusButton({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function check() {
    if (pending) return;
    setPending(true);
    setMessage(null);

    try {
      const response = await fetch("/api/payments/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Only the id. No status, no amount — the server decides both.
        body: JSON.stringify({ transactionId }),
      });
      const data: unknown = await response.json().catch(() => null);
      const parsed =
        data && typeof data === "object" ? (data as Record<string, unknown>) : {};

      if (!response.ok || parsed.ok !== true) {
        const text =
          typeof parsed.error === "string" ? parsed.error : "reconcile_failed";
        const copy = CHECK_ERRORS[text] ?? CHECK_ERRORS.reconcile_failed;
        setMessage(copy);
        toast.error(copy);
        setPending(false);
        return;
      }

      const copy = describe(parsed);
      setMessage(null);
      toast.success(copy);
      // The row is whatever the database says it is now.
      router.refresh();
    } catch {
      const copy = CHECK_ERRORS.network;
      setMessage(copy);
      toast.error(copy);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={check}
        disabled={pending}
        data-testid="check-payment-status"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <RefreshCw aria-hidden />
        )}
        {pending ? "Checking with Paynow" : "Check payment status"}
      </Button>
      <span role="status" aria-live="polite" className="text-xs text-destructive">
        {message ?? ""}
      </span>
    </span>
  );
}

/** Report what the SERVER concluded, in the words the row will now show. */
function describe(parsed: Record<string, unknown>): string {
  const status = typeof parsed.status === "string" ? parsed.status : "";
  const changed = parsed.changed === true;

  if (status === "PAID") {
    return changed
      ? "Payment confirmed. This sale is now marked paid."
      : "Payment already confirmed. This sale is marked paid.";
  }
  if (status === "FAILED") {
    return changed
      ? "Paynow reports the payment did not complete. Nothing was paid."
      : "Paynow has this payment as not completed.";
  }
  if (status === "REFUNDED") {
    return "Paynow reports this payment was refunded.";
  }
  if (parsed.reconciled === false) {
    return "Nothing to check: this sale is no longer waiting for payment.";
  }
  return "Paynow has not confirmed this payment yet. Nothing has changed.";
}

/** Specific where we know the cause, honest where we do not. */
const CHECK_ERRORS: Record<string, string> = {
  no_payment_provider: "Payment status checks aren't available on this deployment.",
  reconciliation_unsupported: "This deployment can't check payment status yet.",
  unauthenticated: "Sign in again to continue.",
  invalid_request: "We couldn't check that payment. Reload and try again.",
  transaction_not_found: "That sale is no longer available.",
  not_a_party: "Only the buyer and seller of this sale can check it.",
  rate_limited: "Too many checks in a row. Wait a minute and try again.",
  invalid_signature: "Paynow's reply could not be verified, so nothing changed.",
  unrecognized_payload: "Paynow sent a status we don't recognise, so nothing changed.",
  malformed_payload: "Paynow's reply could not be read, so nothing changed.",
  amount_mismatch: "Paynow's amount doesn't match this sale, so nothing changed.",
  reference_mismatch: "Paynow answered about a different sale, so nothing changed.",
  currency_mismatch: "This sale isn't in a currency Paynow settles, so nothing changed.",
  no_poll_url:
    "No payment session was recorded for this sale — start the payment again.",
  invalid_poll_url: "This sale has no usable Paynow session. Start the payment again.",
  provider_unreachable:
    "Paynow couldn't be reached, so nothing changed. Try again shortly.",
  provider_error: "The payment service didn't respond. Nothing changed.",
  reconcile_failed: "We couldn't confirm the payment status. Nothing changed.",
  network: "We couldn't reach the server, so nothing changed.",
};
