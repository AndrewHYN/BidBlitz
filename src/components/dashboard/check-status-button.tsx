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
export function CheckStatusButton({
  transactionId,
  providerName,
}: {
  transactionId: string;
  /**
   * Who actually answered, for copy that names a live interaction ("Linkwa
   * confirmed…"). Passed from the server page, which knows the configured
   * provider — never defaulted, because a default would name the wrong
   * party the day the provider changes.
   */
  providerName: string;
}) {
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
        const copy = checkErrorCopy(text, providerName);
        setMessage(copy);
        toast.error(copy);
        setPending(false);
        return;
      }

      const copy = describe(parsed, providerName);
      setMessage(null);
      toast.success(copy);
      // The row is whatever the database says it is now.
      router.refresh();
    } catch {
      const copy = checkErrorCopy("network", providerName);
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
        {pending ? `Checking with ${providerName}` : "Check payment status"}
      </Button>
      <span role="status" aria-live="polite" className="text-xs text-destructive">
        {message ?? ""}
      </span>
    </span>
  );
}

/** Report what the SERVER concluded, in the words the row will now show. */
function describe(parsed: Record<string, unknown>, providerName: string): string {
  const status = typeof parsed.status === "string" ? parsed.status : "";
  const changed = parsed.changed === true;

  // This row is visible to the buyer AND the seller, so "paid" is ambiguous
  // unless the sentence says whose money was confirmed. `PAID` means one
  // specific thing: the provider confirmed the BUYER's payment. The seller's
  // payout is a separate state that this button does not touch, and saying so
  // is the difference between a seller believing they have been paid and
  // being wrong.
  if (status === "PAID") {
    return changed
      ? `${providerName} confirmed the buyer's payment, so this sale is marked paid. The seller's payout is recorded separately.`
      : `${providerName} had already confirmed the buyer's payment. The seller's payout is recorded separately.`;
  }
  if (status === "FAILED") {
    return changed
      ? `${providerName} reports the payment did not complete. Nothing was paid.`
      : `${providerName} has this payment as not completed.`;
  }
  if (status === "REFUNDED") {
    return `${providerName} reports this payment was refunded.`;
  }
  if (parsed.reconciled === false) {
    return "Nothing to check: this sale is no longer waiting for payment.";
  }
  return `${providerName} has not confirmed this payment yet. Nothing has changed.`;
}

/** Specific where we know the cause, honest where we do not. */
function checkErrorCopy(error: string, providerName: string): string {
  switch (error) {
    case "no_payment_provider":
      return "Payment status checks aren't available on this deployment.";
    case "reconciliation_unsupported":
      return "This deployment can't check payment status yet.";
    case "unauthenticated":
      return "Sign in again to continue.";
    case "invalid_request":
      return "We couldn't check that payment. Reload and try again.";
    case "transaction_not_found":
      return "That sale is no longer available.";
    case "not_a_party":
      return "Only the buyer and seller of this sale can check it.";
    case "rate_limited":
      return "Too many checks in a row. Wait a minute and try again.";
    case "invalid_signature":
      return `${providerName}'s reply could not be verified, so nothing changed.`;
    case "unrecognized_payload":
      return `${providerName} sent a status we don't recognise, so nothing changed.`;
    case "malformed_payload":
      return `${providerName}'s reply could not be read, so nothing changed.`;
    case "amount_mismatch":
      return `${providerName}'s amount doesn't match this sale, so nothing changed.`;
    case "reference_mismatch":
      return `${providerName} answered about a different sale, so nothing changed.`;
    case "currency_mismatch":
      return `This sale isn't in a currency ${providerName} settles, so nothing changed.`;
    case "no_poll_url":
      return "No payment session was recorded for this sale. Start the payment again.";
    case "invalid_poll_url":
      return `This sale has no usable ${providerName} session. Start the payment again.`;
    case "provider_unreachable":
      return `${providerName} couldn't be reached, so nothing changed. Try again shortly.`;
    case "provider_error":
      return "The payment service didn't respond. Nothing changed.";
    case "reconcile_failed":
      return "We couldn't confirm the payment status. Nothing changed.";
    case "network":
      return "We couldn't reach the server, so nothing changed.";
    default:
      return "We couldn't confirm the payment status. Nothing changed.";
  }
}
