"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeZimbabwePhone } from "@/lib/phone";
import { readLinkwaEnvironment } from "@/server/payments/config";
import {
  linkLinkwaUser,
  registerLinkwaWallet,
} from "@/server/payments/linkwa-payouts";
import {
  PaymentPayloadError,
  PaymentProviderError,
  PaymentProviderRequestError,
} from "@/server/payments/provider";

const setupSchema = z.object({
  firstName: z.string().trim().min(1, "Enter the payout first name.").max(80),
  lastName: z.string().trim().min(1, "Enter the payout surname.").max(80),
  phone: z.string().trim().min(1, "Enter a Zimbabwe mobile number.").max(30),
});

export async function setupSellerPayoutAction(input: unknown): Promise<
  | { ok: true; status: "READY"; maskedPhone: string }
  | { ok: false; status?: "NEEDS_WALLET"; message: string }
> {
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid payout details." };
  }

  const phone = normalizeZimbabwePhone(parsed.data.phone);
  if (!phone) {
    return {
      ok: false,
      message: "Use a Zimbabwe mobile number such as 0771234567.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again." };

  const linkwa = readLinkwaEnvironment();
  if (linkwa.state !== "ready" || !linkwa.config) {
    return {
      ok: false,
      message: "Seller payouts are not configured on this BidBlitz deployment yet.",
    };
  }

  const admin = createAdminClient();
  const { error: setupError } = await admin.from("seller_payout_recipients").upsert(
    {
      seller_id: user.id,
      provider: "linkwa",
      phone_e164: phone,
      legal_first_name: parsed.data.firstName,
      legal_last_name: parsed.data.lastName,
      setup_status: "LINKING",
      setup_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "seller_id" }
  );
  if (setupError) {
    return {
      ok: false,
      message: "BidBlitz could not save your payout details. Please try again before linking your wallet.",
    };
  }

  let stage = "recipient link";
  try {
    const linked = await linkLinkwaUser(
      { apiKey: linkwa.config.apiKey, baseUrl: linkwa.config.baseUrl },
      {
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        phoneNumber: phone,
        email: user.email ?? undefined,
      }
    );

    const { error: linkSaveError } = await admin.from("seller_payout_recipients").upsert(
      { seller_id: user.id, external_user_id: linked.externalUserId, setup_status: "LINKING", updated_at: new Date().toISOString() },
      { onConflict: "seller_id" }
    );
    if (linkSaveError) return { ok: false, message: "The recipient linked, but BidBlitz could not save it. Contact support before retrying." };
    stage = "wallet link";
    const wallet = await registerLinkwaWallet(
      { apiKey: linkwa.config.apiKey, baseUrl: linkwa.config.baseUrl },
      {
        externalUserId: linked.externalUserId,
        phoneNumber: phone,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
      }
    );

    const now = new Date().toISOString();
    const { error } = await admin.from("seller_payout_recipients").upsert(
      {
        seller_id: user.id,
        provider: "linkwa",
        phone_e164: phone,
        legal_first_name: parsed.data.firstName,
        legal_last_name: parsed.data.lastName,
        external_user_id: linked.externalUserId,
        external_wallet_id: wallet.externalWalletId,
        wallet_provider: "smilecash",
        setup_status: "READY",
        setup_error: null,
        linked_at: now,
        updated_at: now,
      },
      { onConflict: "seller_id" }
    );
    if (error) {
      return { ok: false, message: "The wallet linked, but BidBlitz could not save it. Contact support before selling." };
    }

    revalidatePath("/settings");
    revalidatePath("/settings/payouts");
    revalidatePath("/sell");
    revalidatePath("/dashboard/selling");

    return {
      ok: true,
      status: "READY",
      maskedPhone: `${phone.slice(0, 4)}•••••${phone.slice(-3)}`,
    };
  } catch (error) {
    const needsWallet =
      error instanceof PaymentPayloadError &&
      error.reason === "wallet_registration_required";

    const validationFields = error instanceof PaymentProviderRequestError ? error.validationFields : [];
    await admin.from("seller_payout_recipients").upsert(
      {
        seller_id: user.id,
        provider: "linkwa",
        phone_e164: phone,
        legal_first_name: parsed.data.firstName,
        legal_last_name: parsed.data.lastName,
        setup_status: needsWallet ? "NEEDS_WALLET" : "ERROR",
        setup_error: needsWallet ? "SmileCash wallet required" : `Linkwa ${stage} failed${error instanceof PaymentProviderRequestError && error.httpStatus ? ` (HTTP ${error.httpStatus}${validationFields.length ? `; fields: ${validationFields.join(", ")}` : ""})` : ""}`,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "seller_id" }
    );

    if (needsWallet) {
      return {
        ok: false,
        status: "NEEDS_WALLET",
        message:
          "This number is not linked to a SmileCash wallet yet. Create/activate SmileCash for this number, then return and retry payout setup.",
      };
    }

    if (error instanceof PaymentProviderRequestError && (error.httpStatus === 401 || error.httpStatus === 403)) {
      return { ok: false, message: "Linkwa refused this deployment’s payout access. BidBlitz support must resolve the provider configuration before you retry." };
    }
    if (error instanceof PaymentProviderError) {
      return {
        ok: false,
        message: "Linkwa could not verify this payout wallet. Your details have been saved. BidBlitz support needs to check the provider response before you retry.",
      };
    }
    return { ok: false, message: "Payout setup failed. Nothing was paid or charged." };
  }
}

/**
 * Register an EcoCash/SmileCash contact for staff-managed settlement.
 * No Linkwa API call, provider registration, payment, or payout is made.
 * The database RPC derives the seller identity from the authenticated user.
 */
export async function saveManualPayoutContactAction(input: unknown): Promise<
  | { ok: true; status: "MANUAL_READY"; maskedPhone: string }
  | { ok: false; message: string }
> {
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid payout details." };
  }
  const phone = normalizeZimbabwePhone(parsed.data.phone);
  if (!phone) {
    return { ok: false, message: "Use a Zimbabwe mobile number such as 0771234567." };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again." };

  const { data, error } = await supabase.rpc("set_manual_payout_contact", {
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_phone_e164: phone,
  });
  if (error || data?.ok !== true || data?.status !== "MANUAL_READY") {
    return { ok: false, message: "Could not securely save your transfer contact. Nothing was sent; please retry after checking your details." };
  }
  revalidatePath("/settings/payouts");
  revalidatePath("/sell");
  revalidatePath("/dashboard/selling");
  return {
    ok: true, status: "MANUAL_READY",
    maskedPhone: typeof data.masked_phone === "string" ? data.masked_phone : phone.slice(0,4) + "•••••" + phone.slice(-3),
  };
}
