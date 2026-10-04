/**
 * When a Supabase auth event means the header's server-rendered user is
 * stale, and the only fix is re-reading it from the server.
 *
 * Root cause it encodes: `SiteHeader` renders on the server, so the `user`
 * prop is a snapshot from request time. Password sign-in navigates through a
 * server action (cookies set server-side, next render fresh), but OAuth
 * completes in the BROWSER — `CallbackRunner` sets the session client-side
 * and navigates with `router.replace`, which can leave the header showing
 * "Sign in / Join" for a session that already exists. A full reload fixed it,
 * which proves the session, not the render, was fine.
 *
 * The rule, per event:
 * - SIGNED_IN while the server said signed-out  -> refresh (the OAuth case).
 * - SIGNED_OUT while the server said signed-in   -> refresh (local sign-out).
 * - INITIAL_SESSION differing from the server   -> refresh (a session the
 *   server never saw, e.g. established in another tab before this mount).
 * - Anything else (TOKEN_REFRESHED, USER_UPDATED, …) -> never refresh.
 *   Identity did not change, and refreshing on a timer-adjacent event would
 *   turn background token rotation into foreground request churn.
 *
 * Pure on purpose: the subscription wiring lives in `HeaderBar`, but the
 * decision is testable here without a browser, a network, or a session.
 */
export type AuthStateEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "PASSWORD_RECOVERY"
  | "MFA_CHALLENGE_VERIFIED";

export function shouldRefreshHeaderOnAuthEvent(
  event: AuthStateEvent | string,
  hasSession: boolean,
  serverRenderedSignedIn: boolean
): boolean {
  switch (event) {
    case "SIGNED_IN":
      // A brand-new session the server render predates. Refreshing when the
      // server already knew (e.g. duplicate event delivery) would just burn
      // a request for the same header.
      return hasSession && !serverRenderedSignedIn;
    case "SIGNED_OUT":
      // Session gone locally while the server still rendered a user.
      return !hasSession && serverRenderedSignedIn;
    case "INITIAL_SESSION":
      // The subscription's opening snapshot disagrees with the server
      // snapshot — exactly the OAuth-landed-elsewhere case.
      return hasSession !== serverRenderedSignedIn;
    default:
      return false;
  }
}
