"use server";

import { z } from "zod";
import { isInternationalContactPhone } from "@/lib/phone";
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
