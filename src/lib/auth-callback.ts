/**
 * Pure parsing of an `/auth/callback` landing URL into the credential shape
 * Supabase actually delivered — no network, no storage, no React, so unit
 * tests can pin every shape GoTrue emits.
 *
 * Shapes (all observed against the live provider):
 *   - `?code=` — PKCE links (OAuth, and server-initiated signup while it
 *     used the PKCE flow). Exchanged with `exchangeCodeForSession`, which
 *     needs the PKCE verifier from the initiating browser.
 *   - `?token_hash=&type=` — server-verifiable links for the allowlisted
 *     types only. Anything else is rejected here, never passed to `verifyOtp`.
 *   - `#access_token=&refresh_token=` — the implicit-fragment shape. No
 *     verifier, no cookies, no device affinity: whoever holds the fragment
 *     holds the session. This is what server-initiated signup confirmations
 *     and password recoveries arrive with, and it is the ONLY shape that
 *     survives confirming on a different browser than the one that signed up.
 *   - anything else — not a credential; the caller fails closed.
 */

/** Email-link types this app will ever verify. An allowlist, not a passthrough. */
export type VerifiableLinkType = "recovery" | "signup" | "email_change";

export type CallbackCredentials =
  | { kind: "code"; code: string }
  | { kind: "token"; tokenHash: string; type: VerifiableLinkType }
  | { kind: "fragment"; accessToken: string; refreshToken: string }
  | { kind: "none" };

export interface CallbackUrl {
  get(name: string): string | null;
}

/**
 * Classify the credentials on a callback landing.
 *
 * @param query    the URL query parameters (`useSearchParams()` in the page).
 * @param fragment the URL fragment WITHOUT the leading `#`
 *                 (`window.location.hash.slice(1)` in the page).
 */
export function parseCallbackCredentials(
  query: CallbackUrl,
  fragment: string
): CallbackCredentials {
  const code = query.get("code");
  if (code) {
    return { kind: "code", code };
  }

  const tokenHash = query.get("token_hash");
  const type = query.get("type");
  if (
    tokenHash &&
    (type === "recovery" || type === "signup" || type === "email_change")
  ) {
    return { kind: "token", tokenHash, type };
  }

  const hash = new URLSearchParams(fragment);
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    return { kind: "fragment", accessToken, refreshToken };
  }

  return { kind: "none" };
}
