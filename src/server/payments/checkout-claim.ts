import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { PaymentPayloadError, PaymentProviderError } from "./provider";

/** Reserve the external initiation before making a provider request. A lost
 * reply stays reserved: neither a second click nor another server instance
 * may create a second payable session after an uncertain first request.
 * Recorded sessions can be reopened without creating another reservation.
 */
export async function claimCheckout(
  transactionId: string,
  buyerId: string,
  provider: string
): Promise<"claimed" | "resume" | "held"> {
  const { data, error } = await createAdminClient().rpc("claim_payment_checkout", {
    p_transaction_id: transactionId,
    p_buyer_id: buyerId,
    p_provider: provider,
  });
  if (error) {
    const reason = ["payment_window_expired", "not_awaiting_payment", "existing_provider_payment_pending"]
      .find((value) => error.message === value);
    if (reason) throw new PaymentPayloadError(reason, "This payment cannot be started.");
    throw new PaymentProviderError("PAYMENT_LEDGER_UNAVAILABLE", "Checkout reservation could not be verified.");
  }
  if (data === "claimed" || data === "resume" || data === "held") return data;
  throw new PaymentProviderError("PAYMENT_LEDGER_UNAVAILABLE", "Checkout reservation could not be verified.");
}
