import "server-only";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";

export async function paymentsRuntimeEnabled(): Promise<boolean> {
  if (!hasAdminCredentials()) return false;
  const { data, error } = await createAdminClient()
    .from("payment_settings")
    .select("payments_enabled")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) return false;
  return data.payments_enabled === true;
}


/** Financially separate switch: buyer checkout can be active while the company
 * handles seller payouts through verified manual wallet transfers.
 * No cron disbursement is permitted until deliberately enabled.
 */
export async function automaticSellerPayoutsEnabled(): Promise<boolean> {
  if (!hasAdminCredentials()) return false;
  const { data, error } = await createAdminClient()
    .from("payment_settings")
    .select("payments_enabled, automatic_payouts_enabled")
    .eq("id", 1)
    .maybeSingle();
  return !error && data?.payments_enabled === true && data?.automatic_payouts_enabled === true;
}

/**
 * A separate fail-closed gate for POST /payouts. Linkwa does not document a
 * payout idempotency key or a status lookup, so manual wallet reservations
 * are the safer default even while buyer checkout remains enabled.
 */
export async function linkwaPayoutInstructionsEnabled(): Promise<boolean> {
  if (!hasAdminCredentials()) return false;
  const { data, error } = await createAdminClient()
    .from("payment_settings")
    .select("payments_enabled, linkwa_payout_instructions_enabled")
    .eq("id", 1)
    .maybeSingle();
  return !error && data?.payments_enabled === true
    && data?.linkwa_payout_instructions_enabled === true;
}
