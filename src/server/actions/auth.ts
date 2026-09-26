"use server";

/**
 * Authentication. Supabase Auth handles credentials; we only shape UX and
 * keep the user's profile in sync (a trigger on auth.users does the actual
 * provisioning, so signup and this code cannot drift apart).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/site-url";
import type { BidRejection } from "@/server/errors";

export type AuthResult = { ok: true } | { ok: false; rejection: BidRejection };

function friendlyAuthError(message: string): BidRejection {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) {
    return { code: "not_authenticated", message: "Email or password is incorrect." };
  }
  if (m.includes("already registered")) {
    return { code: "invalid_state", message: "That email is already registered. Try signing in." };
  }
  if (m.includes("password should be at least")) {
    return { code: "invalid_amount", message: "Password must be at least 8 characters." };
  }
  if (m.includes("email not confirmed")) {
    return { code: "invalid_state", message: "Confirm your email address first." };
  }
  if (m.includes("rate limit")) {
    return { code: "rate_limited", message: "Too many attempts. Wait a moment and try again." };
  }
  if (m.includes("unable to validate email") || (m.includes("email address") && m.includes("invalid"))) {
    // GoTrue returns `email_address_invalid` / "Email address ... is invalid"
    // (seen live for reserved TLDs like .test) — say exactly that instead of
    // the generic fallback.
    return { code: "invalid_amount", message: "Enter a valid email address." };
  }
  return { code: "unknown", message: "Sign in failed. Please try again." };
}

export async function signInAction(input: {
  email: string;
  password: string;
  redirectTo?: string;
}): Promise<AuthResult> {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: input.email.trim(),
    password: input.password,
  });

  if (error) return { ok: false, rejection: friendlyAuthError(error.message) };

  revalidatePath("/", "layout");
  redirect(input.redirectTo ?? "/dashboard");
}

export async function signUpAction(input: {
  email: string;
  password: string;
  displayName: string;
  redirectTo?: string;
}): Promise<AuthResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      data: { display_name: input.displayName.trim() },
      // Canonical origin, trailing slash stripped (site-url.ts) — otherwise
      // confirmation links point at "//auth/callback" and miss the route.
      emailRedirectTo: absoluteUrl("/auth/callback"),
    },
  });

  if (error) return { ok: false, rejection: friendlyAuthError(error.message) };

  // auto-confirm is off: tell the truth instead of pretending they are in
  if (data.session === null && data.user !== null) {
    return { ok: true };
  }

  revalidatePath("/", "layout");
  redirect(input.redirectTo ?? "/dashboard");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function updateProfileAction(input: {
  displayName: string;
  bio?: string;
  location?: string;
}): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, rejection: { code: "not_authenticated", message: "Sign in." } };

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: input.displayName.trim(),
      bio: input.bio?.trim() || null,
      location: input.location?.trim() || null,
    })
    .eq("id", user.id);

  if (error) return { ok: false, rejection: friendlyAuthError(error.message) };

  revalidatePath(`/profile/${user.id}`);
  return { ok: true };
}
