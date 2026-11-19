"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MARKETPLACE_LOCATION_COOKIE, normalizeMarketplaceLocation } from "@/lib/marketplace-location";

export async function setHomeLocation(
  _previous: string | null,
  form: FormData,
): Promise<string | null> {
  const location = form.get("scope") === "national" ? "all" : normalizeMarketplaceLocation(form.get("location"));
  if (!location) return "Enter a Zimbabwean town or suburb.";
  (await cookies()).set(MARKETPLACE_LOCATION_COOKIE, location, {
    path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    maxAge: 365 * 24 * 60 * 60,
  });
  redirect("/");
}

export async function saveSignupLocation(
  _previous: string | null,
  form: FormData,
): Promise<string | null> {
  const location = normalizeMarketplaceLocation(form.get("location"));
  if (!location) return "Enter a Zimbabwean town or suburb.";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/signup");
  const { error } = await supabase.auth.updateUser({ data: { marketplace_location: location } });
  if (error) return "We couldn’t save your location. Try again.";
  (await cookies()).delete(MARKETPLACE_LOCATION_COOKIE);
  redirect("/");
}
