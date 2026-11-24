"use server";

import { z } from "zod";
import { isInternationalContactPhone, normalizeListingContactPhone } from "@/lib/phone";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ listingId: z.uuid() });
export type ContactRevealResult = { ok: true; phone: string } | { ok: false; message: string };

export async function revealListingContactAction(input: unknown): Promise<ContactRevealResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid listing." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to view contact details." };

  // The database function checks the caller, listing status and seller identity,
  // rate-limits reveals transactionally and logs each successful reveal.
  const { data, error } = await supabase.rpc("reveal_listing_contact", {
    p_listing_id: parsed.data.listingId,
  });
  if (error) {
    if (error.message.includes("rate_limited")) {
      return { ok: false, message: "Too many contact requests. Please try again later." };
    }
    return { ok: false, message: "Seller contact is not available for this listing." };
  }
  if (typeof data !== "string" || !isInternationalContactPhone(data)) {
    return { ok: false, message: "Seller contact is unavailable right now." };
  }
  return { ok: true, phone: data };
}

const updateContactSchema = z.object({
  listingId: z.uuid(),
  phone: z.string().max(32),
  expectedPhone: z.string().refine(isInternationalContactPhone),
  consent: z.literal(true),
});

/** Only the seller can correct a direct listing's private contact number. */
export async function updateListingContactAction(input: unknown): Promise<ContactRevealResult> {
  const parsed = updateContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the phone number and confirm contact sharing." };
  const phone = normalizeListingContactPhone(parsed.data.phone);
  if (!phone) return { ok: false, message: "Enter a Zimbabwean number or an international number with its country code." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to edit your listing." };
  const { data, error } = await supabase.rpc("update_listing_contact", {
    p_listing_id: parsed.data.listingId,
    p_phone: phone,
    p_expected_phone: parsed.data.expectedPhone,
  });
  if (error || data !== phone) {
    return { ok: false, message: error?.message.includes("contact_changed")
      ? "The number has changed. Refresh the page and try again."
      : "Could not update the contact number. Check that this listing is yours and is editable." };
  }
  revalidatePath(`/sell/${parsed.data.listingId}`);
  revalidatePath(`/listing/${parsed.data.listingId}`);
  revalidatePath("/dashboard/selling");
  return { ok: true, phone };
}
