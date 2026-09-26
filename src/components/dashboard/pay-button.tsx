"use client";

import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Start payment for a won auction.
 *
 * Only ever rendered when a payment provider is actually configured, so the
 * button never leads to a dead end and no screen implies money can move when
 * it cannot.
 *
 * What a click does: ask the server to open a payment intent, then hand the
 * browser to the provider's payment page. The transaction stays
 * AWAITING_PAYMENT until the provider confirms server-to-server — a redirect
 * back here does NOT mean "paid", and this component never claims it does.
 */
export function PayButton({ transactionId }: { transactionId: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function startPayment() {
    if (pending) return;
    setPending(true);
    setMessage(null);

    try {
      const response = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionId }),
      });
      const data: unknown = await response.json().catch(() => null);
      const parsed =
        data && typeof data === "object" ? (data as Record<string, unknown>) : {};

      if (!response.ok || parsed.ok !== true) {
        const text =
          typeof parsed.error === "string" ? parsed.error : "checkout_failed";
        const copy = CHECKOUT_ERRORS[text] ?? CHECKOUT_ERRORS.checkout_failed;
        setMessage(copy);
        toast.error(copy);
        setPending(false);
        return;
      }

      if (typeof parsed.redirectUrl !== "string" || parsed.redirectUrl === "") {
        setMessage(CHECKOUT_ERRORS.checkout_failed);
        toast.error(CHECKOUT_ERRORS.checkout_failed);
        setPending(false);
        return;
      }

      // Leave the site for the provider's payment page. Whatever comes back
      // to our return URL only updates the UI after the webhook confirms.
      window.location.assign(parsed.redirectUrl);
    } catch {
      setMessage(CHECKOUT_ERRORS.network);
      toast.error(CHECKOUT_ERRORS.network);
      setPending(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        onClick={startPayment}
        disabled={pending}
        data-testid="pay-transaction"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <CreditCard aria-hidden />
        )}
        {pending ? "Opening payment page" : "Pay now"}
      </Button>
      <span role="status" aria-live="polite" className="text-xs text-destructive">
        {message ?? ""}
      </span>
    </span>
  );
}

/** Specific where we know the cause, honest where we do not. */
const CHECKOUT_ERRORS: Record<string, string> = {
  no_payment_provider: "Payment isn't available yet, so nothing has been charged.",
  unauthenticated: "Sign in again to continue.",
  invalid_request: "We couldn't start that payment. Reload the page and try again.",
  transaction_not_found: "That sale is no longer available to pay for.",
  not_the_buyer: "Only the winning bidder can pay for this sale.",
  not_awaiting_payment: "This sale isn't waiting for payment.",
  unsupported_currency: "Paynow settles in USD, so this sale can't be paid for yet.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  provider_error: "The payment service didn't respond. Nothing was charged.",
  checkout_failed: "We couldn't start the payment. Nothing was charged.",
  network: "We couldn't reach the server. Nothing was charged.",
};
