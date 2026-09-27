"use server";

/**
 * Authentication. Supabase Auth handles credentials; we only shape UX and
 * keep the user's profile in sync (a trigger on auth.users does the actual
 * provisioning, so signup and this code cannot drift apart).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/site-url";
import { safeNext } from "@/lib/safe-next";
import { AUTH_LIMIT, peekRateLimit, rateLimit } from "@/server/rate-limit";
import type { BidRejection } from "@/server/errors";

export type AuthResult = { ok: true } | { ok: false; rejection: BidRejection };

/**
 * BidBlitz's OWN failure budget ran out (see `authFailureKey`). This says so,
 * in its own words, so it can never be confused with a provider throttle.
 */
const AUTH_RATE_MESSAGE =
  "Too many attempts from this device. Please wait about a minute, then try again.";

/**
 * The identity provider (Supabase Auth / GoTrue) is throttling us — an email
 * send quota, an IP burst limit, a 429. It is a temporary property of the
 * provider, not a failed attempt, so it gets its own honest wording instead of
 * being dressed up as our limiter.
 */
const PROVIDER_RATE_MESSAGE =
  "Our account service is temporarily rate-limiting requests. Please wait a few minutes and try again.";

/**
 * Budget key for FAILED sign-in/sign-up attempts: client IP + email.
 *
 * A Server Action payload is directly invocable, so the scope comes from the
 * request's forwarded hop and the submitted email — nothing else the caller
 * controls. Only failures consume budget (`peekRateLimit` before the attempt,
 * `rateLimit` after it fails), so routine sign-ins are never throttled while
 * password guessing against one account is capped at AUTH_LIMIT per window, on
 * top of GoTrue's own rate limiting. In-memory by design — see rate-limit.ts.
 *
 * Three things deliberately do NOT consume this budget, because consuming it
 * would make the user's problem worse rather than better:
 *   1. a successful sign-in or sign-up (nothing failed),
 *   2. a provider rate-limit response (see `providerThrottled` below),
 *   3. the check itself — `peekRateLimit` never records a hit.
 */
async function authFailureKey(email: string): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  const scope = ip && ip.length > 0 ? ip : "unknown";
  return `auth:${scope}:${email.trim().toLowerCase()}`;
}

/** What a provider rejection turned into, plus whether it was a throttle. */
type AuthFailure = { rejection: BidRejection; providerThrottled: boolean };

/**
 * Was this the identity provider telling us to slow down?
 *
 * GoTrue surfaces its send quota as `over_email_send_rate_limit` ("Over email
 * send rate limit"), bursts as `too_many_requests` ("Too many requests"), and
 * OTP/resend cooldowns as "Security purposes, please try again later". The
 * AuthApiError also carries an HTTP status, so 429 is authoritative.
 *
 * This is the recursion guard: a GoTrue throttle must not also burn a BidBlitz
 * failure. If it did, the provider's 60-second cooldown would silently extend
 * ours, five retries would strand the user for the whole window, and "wait a
 * moment" would be a lie. Provider throttles are therefore reported honestly
 * and left out of our own budget.
 */
function isProviderThrottle(message: string, status?: number): boolean {
  if (status === 429) return true;
  const m = message.toLowerCase();
  return (
    m.includes("rate limit") ||
    m.includes("too many request") ||
    m.includes("too many attempts") ||
    m.includes("security purposes") ||
    m.includes("try again later")
  );
}

/**
 * `AuthApiError` carries the HTTP status alongside the message; the base
 * `AuthError` type does not, so read it defensively. 429 is the authoritative
 * "the provider is throttling" signal and does not depend on message wording.
 */
function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

function classifyAuthFailure(message: string, status?: number): AuthFailure {
  const m = message.toLowerCase();
  const fail = (rejection: BidRejection, providerThrottled = false): AuthFailure => ({
    rejection,
    providerThrottled,
  });

  if (m.includes("invalid login")) {
    return fail({ code: "not_authenticated", message: "Email or password is incorrect." });
  }
  if (m.includes("already registered")) {
    return fail({
      code: "invalid_state",
      message: "That email is already registered. Try signing in.",
    });
  }
  if (m.includes("password should be at least")) {
    return fail({ code: "invalid_amount", message: "Password must be at least 8 characters." });
  }
  if (m.includes("email not confirmed")) {
    return fail({ code: "invalid_state", message: "Confirm your email address first." });
  }
  if (isProviderThrottle(message, status)) {
    return fail({ code: "rate_limited", message: PROVIDER_RATE_MESSAGE }, true);
  }
  if (
    m.includes("unable to validate email") ||
    (m.includes("email address") && m.includes("invalid"))
  ) {
    // GoTrue returns `email_address_invalid` / "Email address ... is invalid"
    // (seen live for reserved TLDs like .test) — say exactly that instead of
    // the generic fallback.
    return fail({ code: "invalid_amount", message: "Enter a valid email address." });
  }
  return fail({ code: "unknown", message: "Sign in failed. Please try again." });
}

function friendlyAuthError(message: string): BidRejection {
  return classifyAuthFailure(message).rejection;
}

export async function signInAction(input: {
  email: string;
  password: string;
  redirectTo?: string;
}): Promise<AuthResult> {
  const budgetKey = await authFailureKey(input.email);
  if (!peekRateLimit(budgetKey, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs).allowed) {
    return { ok: false, rejection: { code: "rate_limited", message: AUTH_RATE_MESSAGE } };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: input.email.trim(),
    password: input.password,
  });

  if (error) {
    const failure = classifyAuthFailure(error.message, statusOf(error));
    // Only a real attempt failure spends budget. A provider throttle does not:
    // see `isProviderThrottle`.
    if (!failure.providerThrottled) {
      rateLimit(budgetKey, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs); // record the failure
    }
    return { ok: false, rejection: failure.rejection };
  }

  revalidatePath("/", "layout");
  redirect(safeNext(input.redirectTo));
}

export async function signUpAction(input: {
  email: string;
  password: string;
  displayName: string;
  redirectTo?: string;
}): Promise<AuthResult> {
  const budgetKey = await authFailureKey(input.email);
  if (!peekRateLimit(budgetKey, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs).allowed) {
    return { ok: false, rejection: { code: "rate_limited", message: AUTH_RATE_MESSAGE } };
  }

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

  if (error) {
    const failure = classifyAuthFailure(error.message, statusOf(error));
    // Same rule as sign-in: GoTrue's own throttle stays out of our budget so
    // the two limiters cannot multiply each other.
    if (!failure.providerThrottled) {
      rateLimit(budgetKey, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs); // record the failure
    }
    return { ok: false, rejection: failure.rejection };
  }

  // auto-confirm is off: tell the truth instead of pretending they are in
  if (data.session === null && data.user !== null) {
    return { ok: true };
  }

  revalidatePath("/", "layout");
  redirect(safeNext(input.redirectTo));
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
