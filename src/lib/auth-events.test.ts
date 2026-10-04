import { describe, expect, it } from "vitest";
import { shouldRefreshHeaderOnAuthEvent } from "./auth-events";

/**
 * The header shows a server snapshot of the user, so a browser-side session
 * change (notably OAuth completing in CallbackRunner) can leave it stale
 * until something re-reads the server. These tests pin exactly which events
 * may trigger that re-read — refreshing on anything else would turn
 * background token rotation into foreground request churn, and missing one
 * of these three reproduces the "Sign in / Join after Google login" bug.
 */
describe("shouldRefreshHeaderOnAuthEvent", () => {
  it("refreshes on SIGNED_IN the server render predates (the OAuth case)", () => {
    expect(shouldRefreshHeaderOnAuthEvent("SIGNED_IN", true, false)).toBe(true);
  });

  it("does not refresh on a duplicate SIGNED_IN the server already knew", () => {
    expect(shouldRefreshHeaderOnAuthEvent("SIGNED_IN", true, true)).toBe(false);
  });

  it("never treats a session-less SIGNED_IN as a change", () => {
    expect(shouldRefreshHeaderOnAuthEvent("SIGNED_IN", false, false)).toBe(false);
    expect(shouldRefreshHeaderOnAuthEvent("SIGNED_IN", false, true)).toBe(false);
  });

  it("refreshes on SIGNED_OUT while the server still rendered a user", () => {
    expect(shouldRefreshHeaderOnAuthEvent("SIGNED_OUT", false, true)).toBe(true);
  });

  it("does not refresh on SIGNED_OUT when already signed out", () => {
    expect(shouldRefreshHeaderOnAuthEvent("SIGNED_OUT", false, false)).toBe(false);
  });

  it("refreshes on an INITIAL_SESSION the server never saw", () => {
    expect(shouldRefreshHeaderOnAuthEvent("INITIAL_SESSION", true, false)).toBe(true);
    expect(shouldRefreshHeaderOnAuthEvent("INITIAL_SESSION", false, true)).toBe(true);
  });

  it("does not refresh on an INITIAL_SESSION that agrees with the server", () => {
    expect(shouldRefreshHeaderOnAuthEvent("INITIAL_SESSION", true, true)).toBe(false);
    expect(shouldRefreshHeaderOnAuthEvent("INITIAL_SESSION", false, false)).toBe(false);
  });

  it("never refreshes on token rotation, profile updates, or unknown events", () => {
    for (const event of [
      "TOKEN_REFRESHED",
      "USER_UPDATED",
      "PASSWORD_RECOVERY",
      "MFA_CHALLENGE_VERIFIED",
      "SOMETHING_NEW",
    ]) {
      expect(shouldRefreshHeaderOnAuthEvent(event, true, true)).toBe(false);
      expect(shouldRefreshHeaderOnAuthEvent(event, true, false)).toBe(false);
      expect(shouldRefreshHeaderOnAuthEvent(event, false, true)).toBe(false);
      expect(shouldRefreshHeaderOnAuthEvent(event, false, false)).toBe(false);
    }
  });
});
