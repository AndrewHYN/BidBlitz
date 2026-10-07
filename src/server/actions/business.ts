"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BUSINESS_LOGO_BUCKET,
  BUSINESS_LOGO_MAX_BYTES,
  businessLogoUrl,
} from "@/lib/business";
import { validateAvatarBytes, type AvatarExt } from "@/lib/avatar";

const profileSchema = z.object({
  displayName: z.string().trim().min(2, "Business name is too short.").max(80),
  description: z.string().trim().max(1200, "Keep the business description under 1200 characters."),
  location: z.string().trim().max(120, "Keep the business location under 120 characters."),
});

const identitySchema = z.object({
  auctionId: z.string().uuid("Invalid auction"),
  businessId: z.string().uuid().nullable(),
});

export type BusinessActionResult =
  | { ok: true; businessId: string; slug: string }
  | { ok: false; message: string };

async function sessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function saveBusinessProfileAction(input: unknown): Promise<BusinessActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid business profile." };
  }

  const { supabase, user } = await sessionUser();
  if (!user) return { ok: false, message: "Sign in again." };

  const { data, error } = await supabase.rpc("upsert_my_business", {
    p_display_name: parsed.data.displayName,
    p_description: parsed.data.description || null,
    p_location: parsed.data.location || null,
  });
  if (error || !data) {
    return { ok: false, message: "BidBlitz could not save the business profile." };
  }

  const row = data as {
    id: string;
    slug: string;
  };

  revalidatePath("/settings");
  revalidatePath("/settings/business");
  revalidatePath(`/business/${row.slug}`);
  return { ok: true, businessId: row.id, slug: row.slug };
}

export async function setAuctionBusinessIdentityAction(
  input: unknown
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid seller identity." };
  }

  const { supabase, user } = await sessionUser();
  if (!user) return { ok: false, message: "Sign in again." };

  const { error } = await supabase.rpc("set_auction_business_identity", {
    p_auction_id: parsed.data.auctionId,
    p_business_id: parsed.data.businessId,
  });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("identity_locked")) {
      return { ok: false, message: "Seller identity locks when the draft is published." };
    }
    if (m.includes("business_not_owned")) {
      return { ok: false, message: "That business profile is not available to this account." };
    }
    return { ok: false, message: "BidBlitz could not change the seller identity." };
  }

  revalidatePath(`/sell/${parsed.data.auctionId}`);
  revalidatePath(`/auction/${parsed.data.auctionId}`);
  return { ok: true };
}

function mimeFor(ext: AvatarExt): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
  }
}

export async function uploadBusinessLogoAction(
  formData: FormData
): Promise<{ ok: true; logoUrl: string } | { ok: false; message: string }> {
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a logo image first." };
  }
  if (file.size > BUSINESS_LOGO_MAX_BYTES) {
    return { ok: false, message: "Business logos must be 2 MB or smaller." };
  }

  const { user } = await sessionUser();
  if (!user) return { ok: false, message: "Sign in again." };

  const admin = createAdminClient();
  const { data: business } = await admin
    .from("business_sellers")
    .select("id, slug, logo_path")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!business) {
    return { ok: false, message: "Create your business profile before adding a logo." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateAvatarBytes(bytes);
  if (!validated.ok) {
    return { ok: false, message: "Use a real JPEG, PNG, WebP or GIF logo image." };
  }

  const key = `${business.id}/logo.${validated.ext}`;
  const { error: uploadError } = await admin.storage
    .from(BUSINESS_LOGO_BUCKET)
    .upload(key, bytes, {
      upsert: true,
      contentType: mimeFor(validated.ext),
      cacheControl: "3600",
    });
  if (uploadError) {
    console.error("[business-logo] upload failed", uploadError.message);
    return { ok: false, message: "BidBlitz could not upload that logo." };
  }

  const { error: saveError } = await admin
    .from("business_sellers")
    .update({ logo_path: key, updated_at: new Date().toISOString() })
    .eq("id", business.id)
    .eq("owner_id", user.id);
  if (saveError) {
    await admin.storage.from(BUSINESS_LOGO_BUCKET).remove([key]);
    return { ok: false, message: "BidBlitz could not save that logo." };
  }

  if (business.logo_path && business.logo_path !== key) {
    await admin.storage.from(BUSINESS_LOGO_BUCKET).remove([business.logo_path]);
  }

  revalidatePath("/settings/business");
  revalidatePath(`/business/${business.slug}`);
  const logoUrl = businessLogoUrl(key);
  return logoUrl
    ? { ok: true, logoUrl }
    : { ok: false, message: "The logo was saved but its public URL could not be built." };
}

export async function removeBusinessLogoAction(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const { user } = await sessionUser();
  if (!user) return { ok: false, message: "Sign in again." };

  const admin = createAdminClient();
  const { data: business } = await admin
    .from("business_sellers")
    .select("id, slug, logo_path")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!business) return { ok: false, message: "Business profile not found." };

  if (business.logo_path) {
    await admin.storage.from(BUSINESS_LOGO_BUCKET).remove([business.logo_path]);
  }
  const { error } = await admin
    .from("business_sellers")
    .update({ logo_path: null, updated_at: new Date().toISOString() })
    .eq("id", business.id)
    .eq("owner_id", user.id);
  if (error) return { ok: false, message: "BidBlitz could not remove the logo." };

  revalidatePath("/settings/business");
  revalidatePath(`/business/${business.slug}`);
  return { ok: true };
}
