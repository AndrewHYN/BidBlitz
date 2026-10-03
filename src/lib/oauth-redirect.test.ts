import { describe, expect, it } from "vitest";
import { googleOAuthRedirectTo } from "./oauth-redirect";
import { absoluteUrl } from "./site-url";
import { safeNext } from "./safe-next";

/**
 * The OAuth landing must be the canonical callback with a validated `next`,
 * built from the same two helpers as every email link. Anything else is an
 * open redirect waiting for a provider to bounce through.
 */
describe("googleOAuthRedirectTo", () => {
  it("lands on the canonical application callback", () => {
    expect(googleOAuthRedirectTo("/dashboard")).toBe(
      `${absoluteUrl("/auth/callback")}?next=${encodeURIComponent("/dashboard")}`
    );
  });

  it("preserves a valid same-origin destination", () => {
    expect(googleOAuthRedirectTo("/sell")).toContain(`next=${encodeURIComponent("/sell")}`);
  });

  it("falls back for an external redirect target", () => {
    expect(googleOAuthRedirectTo("https://evil.example")).toBe(
      `${absoluteUrl("/auth/callback")}?next=${encodeURIComponent(safeNext("https://evil.example"))}`
    );
    expect(googleOAuthRedirectTo("https://evil.example")).not.toContain("evil.example");
  });

  it("falls back for protocol-relative, backslash and scheme tricks", () => {
    for (const evil of ["//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      expect(googleOAuthRedirectTo(evil)).not.toContain("evil.example");
      expect(googleOAuthRedirectTo(evil)).not.toContain("alert");
    }
  });

  it("defaults a missing destination to the dashboard", () => {
    expect(googleOAuthRedirectTo(undefined)).toContain(`next=${encodeURIComponent("/dashboard")}`);
    expect(googleOAuthRedirectTo(null)).toContain(`next=${encodeURIComponent("/dashboard")}`);
  });

  it("never hardcodes a hostname", () => {
    expect(googleOAuthRedirectTo("/dashboard")).not.toContain("bid-blitz-ten.vercel.app");
    expect(googleOAuthRedirectTo("/dashboard")).not.toContain("bidblitz.co.zw");
    expect(googleOAuthRedirectTo("/dashboard")).not.toContain("//auth/callback");
  });
});
