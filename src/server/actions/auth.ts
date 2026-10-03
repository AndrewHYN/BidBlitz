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
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";

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
    // The shared classifier's fallback speaks sign-in ("Sign in failed").
    // Surfacing that on this form would tell a new user their sign-in broke
    // when account creation did — same code, honest signup wording.
    if (failure.rejection.code === "unknown") {
      return {
        ok: false,
        rejection: { code: "unknown", message: "Account creation failed. Please try again." },
      };
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

  /*
   * `select("username")` is not cosmetic. The public profile route is
   * `/profile/[username]`, so revalidating a path built from `user.id` throws
   * away a cache entry for a URL that does not exist while leaving the real one
   * stale - which is what this did. Editing your display name, bio or location
   * and finding the old text still on your public profile is the visible result.
   *
   * Returning the row also keeps RLS honest: the update is still filtered to
   * `user.id`, so a row the caller may not write is never returned, and an empty
   * result is reported as a failure rather than silently succeeding.
   */
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({
      display_name: input.displayName.trim(),
      bio: input.bio?.trim() || null,
      location: input.location?.trim() || null,
    })
    .eq("id", user.id)
    .select("username")
    .single();

  if (error) return { ok: false, rejection: friendlyAuthError(error.message) };
  if (!updated?.username) {
    return {
      ok: false,
      rejection: { code: "unknown", message: "We couldn't save those details. Please try again." },
    };
  }

  // The two surfaces that can show these values: the page being edited, and the
  // public profile. The header also carries the display name, and it lives in the
  // root layout, so it is refreshed with the layout rather than path by path.
  revalidatePath("/settings");
  revalidatePath(`/profile/${updated.username}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Ask the provider to email a recovery link.
 *
 * **This never says whether an account exists, and that is enforced rather than
 * assumed.** The provider does distinguish them — measured live on 2026-09-28,
 * an unknown address returns HTTP 200 `{}` while a real account returns 429
 * `over_email_send_rate_limit` — so any provider error forwarded to the caller
 * is an account-enumeration oracle. Every provider response is therefore
 * normalised to the same generic outcome. The evidence and the reasoning are at
 * the `if (error)` branch below, because this is the decision that matters.
 *
 * Our own budget is the one failure still reported: it is scoped to the
 * request's IP and the submitted address, so it gives the same answer whether or
 * not the account exists, and telling the truth there leaks nothing.
 *
 * The link is routed through the existing `/auth/callback`, which already
 * exchanges a `code` for a session cookie and honours a validated `next` — so
 * recovery reuses the one redirect rule the app already has rather than adding
 * a second one that could disagree with it.
 */
export async function requestPasswordResetAction(input: {
  email: string;
}): Promise<{ ok: true } | { ok: false; rejection: BidRejection }> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    return { ok: false, rejection: { code: "invalid_input", message: "Enter your email address." } };
  }

  const budgetKey = await authFailureKey(email);
  if (!peekRateLimit(budgetKey, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs).allowed) {
    return { ok: false, rejection: { code: "rate_limited", message: AUTH_RATE_MESSAGE } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${absoluteUrl("/auth/callback")}?next=${encodeURIComponent("/reset-password")}`,
  });

  if (error) {
    const failure = classifyAuthFailure(error.message, statusOf(error));
    /*
     * Swallowed on purpose, and this is the important decision in the file.
     *
     * Measured against the live provider on 2026-09-28:
     *
     *   unknown address -> HTTP 200, {}
     *   real account    -> HTTP 429, over_email_send_rate_limit
     *
     * The provider answers a KNOWN address differently from an unknown one, and
     * the difference is an error. So forwarding that error — which the first
     * version of this function did, on the reasonable-sounding grounds that
     * "we must not tell a user to check an inbox when we know no email was
     * sent" — turns this form into an account-enumeration oracle: submit any
     * address, and a rate-limit error means "this person has a BidBlitz
     * account". Enumeration is how phishers and credential-stuffers choose
     * targets, and it is a far worse outcome than a user waiting a few minutes
     * for an email that the provider's own 2-per-hour quota has delayed.
     *
     * That quota is not theoretical either: it is the real, current setting, so
     * the oracle was open in production, not only in theory.
     *
     * So every provider response is normalised to the same generic outcome. The
     * one failure that is still reported is OUR OWN budget, which is scoped to
     * the request's IP and the submitted address and therefore does not depend
     * on whether the account exists — "too many attempts from this device" is
     * the same answer for every address, so telling the truth there leaks
     * nothing.
     */
    if (!failure.providerThrottled) {
      // A non-throttle error is also swallowed: it is provider-specific
      // detail, and some of it (an "user not found" style message) would be an
      // enumeration signal just as directly.
      console.warn("[auth] password reset request failed:", error.message);
    }
    return { ok: true };
  }

  return { ok: true };
}

/**
 * Re-send the signup confirmation email to an address that may already have
 * an unconfirmed account.
 *
 * There was no resend path before this: a user whose confirmation email never
 * arrived (provider outage, spam filter, typo'd inbox rules) had no recourse
 * except signing up again — which GoTrue answers with "already registered",
 * a dead end. This uses GoTrue's supported resend mechanism for signup
 * confirmations, routed through the same canonical `/auth/callback` the
 * original signup email uses.
 *
 * Enumeration safety mirrors `requestPasswordResetAction` exactly: the
 * provider answers known and unknown addresses differently, so every provider
 * response — success, unknown-address success, already-confirmed, send
 * failure, throttle — is normalised to the same generic outcome. The only
 * failure ever reported is BidBlitz's own per-IP+address budget, which is
 * identical for every address and therefore leaks nothing.
 */
export async function resendConfirmationAction(input: {
  email: string;
}): Promise<{ ok: true } | { ok: false; rejection: BidRejection }> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    return { ok: false, rejection: { code: "invalid_input", message: "Enter your email address." } };
  }

  const budgetKey = await authFailureKey(email);
  if (!peekRateLimit(budgetKey, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs).allowed) {
    return { ok: false, rejection: { code: "rate_limited", message: AUTH_RATE_MESSAGE } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      // Same canonical callback as signUpAction: the confirmation link must
      // land on the route that completes email-link sign-ins.
      emailRedirectTo: absoluteUrl("/auth/callback"),
    },
  });

  if (error) {
    const failure = classifyAuthFailure(error.message, statusOf(error));
    if (!failure.providerThrottled) {
      console.warn("[auth] confirmation resend failed:", error.message);
    }
    // Swallowed on purpose (see above): known, unknown, already-confirmed
    // and send-failed addresses all get the same answer.
    return { ok: true };
  }

  return { ok: true };
}

/**
 * Ask the provider to email a six-digit sign-in code, without creating an
 * account.
 *
 * Secondary login only: password sign-in stays primary and this never
 * registers anyone. `shouldCreateUser: false` is load-bearing, not
 * decorative — without it a typo'd address on this screen would silently
 * mint a second account and strand the user in an inbox they may not own.
 * Signup stays on the explicit `/signup` path with display name + password.
 *
 * Enumeration safety mirrors `requestPasswordResetAction`: GoTrue answers
 * known and unknown addresses differently (notably, with user creation off
 * an unknown address is an error), so every provider response is normalised
 * to the same generic outcome. Only BidBlitz's own per-IP+address budget is
 * ever reported, and it is identical for every address.
 */
export async function requestEmailLoginCodeAction(input: {
  email: string;
}): Promise<{ ok: true } | { ok: false; rejection: BidRejection }> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    return { ok: false, rejection: { code: "invalid_input", message: "Enter your email address." } };
  }

  const budgetKey = await authFailureKey(email);
  if (!peekRateLimit(budgetKey, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs).allowed) {
    return { ok: false, rejection: { code: "rate_limited", message: AUTH_RATE_MESSAGE } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Login must never become registration. GoTrue auto-creates users on
      // passwordless request by default; this disables exactly that.
      shouldCreateUser: false,
    },
  });

  if (error) {
    const failure = classifyAuthFailure(error.message, statusOf(error));
    if (!failure.providerThrottled) {
      console.warn("[auth] login code request failed:", error.message);
    }
    // Swallowed on purpose (see above): known, unknown and throttled
    // addresses all get the same answer. A throttle additionally means the
    // email is merely delayed, so success is the honest outcome there too.
    return { ok: true };
  }

  return { ok: true };
}

/**
 * The single wrong-code message. Live GoTrue answers wrong AND expired codes
 * with the same "Token has expired or is invalid", so one copy covers both
 * remedies instead of lying about which happened. Shared by the malformed,
 * incorrect and expired paths below.
 */
const WRONG_CODE_MESSAGE =
  "That code didn't work. Check the email and try again, or request a new one.";

/**
 * Verify a six-digit email sign-in code and establish the session.
 *
 * On success this ends in `redirect()`, exactly like `signInAction`: the
 * session cookie is set server-side and the browser lands on the same
 * validated destination. A wrong or stale code never creates a session.
 */
export async function verifyEmailLoginCodeAction(input: {
  email: string;
  token: string;
  redirectTo?: string;
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const token = input.token.trim();

  // Malformed and wrong share the single message above on purpose:
  // distinguishing them would give a guesser a free validity oracle.
  if (!/^\d{6}$/.test(token)) {
    return {
      ok: false,
      rejection: {
        code: "invalid_input",
        message: WRONG_CODE_MESSAGE,
      },
    };
  }

  const budgetKey = await authFailureKey(email);
  if (!peekRateLimit(budgetKey, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs).allowed) {
    return { ok: false, rejection: { code: "rate_limited", message: AUTH_RATE_MESSAGE } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error) {
    const failure = classifyAuthFailure(error.message, statusOf(error));
    // A provider throttle is the provider's cooldown, not a failed guess:
    // report it honestly and keep it out of our budget, like everywhere else.
    if (failure.providerThrottled) {
      return { ok: false, rejection: failure.rejection };
    }
    rateLimit(budgetKey, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs); // record the failed guess
    return {
      ok: false,
      rejection: {
        code: "invalid_input",
        message: WRONG_CODE_MESSAGE,
      },
    };
  }

  revalidatePath("/", "layout");
  redirect(safeNext(input.redirectTo));
}

/**
 * Set a new password, using the recovery session the emailed link established.
 *
 * There is no email parameter and no lookup: whoever holds a valid recovery
 * session sets the password for that session's own user. A reset link is a
 * bearer credential, so it is never combined with anything the caller could
 * swap — otherwise "reset Alice's password with Bob's link" becomes possible.
 *
 * Without a recovery session this is refused, which is the correct outcome for
 * an expired or already-used link, and the page turns it into an explanation
 * rather than a generic error.
 */
export async function updatePasswordAction(input: {
  password: string;
}): Promise<{ ok: true } | { ok: false; rejection: BidRejection }> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      rejection: {
        code: "invalid_input",
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      rejection: {
        code: "reset_link_invalid",
        message: "This reset link has expired or was already used. Request a new one.",
      },
    };
  }

  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) {
    // A stale recovery token surfaces here rather than at getUser() on some
    // providers, so the same honest message covers both.
    const m = error.message.toLowerCase();
    if (m.includes("session") || m.includes("token") || m.includes("expired")) {
      return {
        ok: false,
        rejection: {
          code: "reset_link_invalid",
          message: "This reset link has expired or was already used. Request a new one.",
        },
      };
    }
    return { ok: false, rejection: friendlyAuthError(error.message) };
  }

  return { ok: true };
}

/**
 * Change the password for an already-authenticated user (Settings → Security).
 *
 * This is NOT the recovery flow: the caller holds a normal session, not a
 * single-use recovery grant. Supabase's `updateUser({ password })` is the same
 * primitive, but the preconditions and the outcome differ — a missing session
 * here means "sign in again", never "request a new reset link", and the
 * session survives the change (the user stays signed in). No current-password
 * check: GoTrue does not require it for an authenticated `updateUser`, and
 * asking for a credential the server never verifies would be theater.
 */
export async function changePasswordAction(input: {
  password: string;
}): Promise<{ ok: true } | { ok: false; rejection: BidRejection }> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      rejection: {
        code: "invalid_input",
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      rejection: {
        code: "not_authenticated",
        message: "Sign in again, then try changing your password.",
      },
    };
  }

  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) {
    return { ok: false, rejection: friendlyAuthError(error.message) };
  }

  return { ok: true };
}
