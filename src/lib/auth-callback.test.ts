import { describe, expect, it } from "vitest";
import { parseCallbackCredentials } from "./auth-callback";

function query(params: Record<string, string>) {
  const store = new Map(Object.entries(params));
  return { get: (name: string) => store.get(name) ?? null };
}

/**
 * Regression suite for the production incident of 2026-10-04: every email
 * confirmation click failed with "We couldn't complete sign-in from your
 * email link" because the callback only ever completed the PKCE `?code=`
 * shape, whose verifier cookie is host-bound to the signup page's origin —
 * while production signup emails pointed at a different host.
 *
 * These tests pin the shape that fix relies on: a server-initiated signup
 * confirmation arrives as an implicit fragment (`#access_token`,
 * `#refresh_token`, `type=signup`), and the callback must extract session
 * credentials from it with no verifier, no cookies and no device affinity.
 */
describe("parseCallbackCredentials", () => {
  it("extracts a session from a signup confirmation fragment", () => {
    const result = parseCallbackCredentials(
      query({}),
      "access_token=AAA&refresh_token=RRR&expires_in=3600&token_type=bearer&type=signup"
    );

    expect(result).toEqual({
      kind: "fragment",
      accessToken: "AAA",
      refreshToken: "RRR",
    });
  });

  it("extracts a session from a recovery fragment", () => {
    const result = parseCallbackCredentials(
      query({}),
      "access_token=AAA&refresh_token=RRR&type=recovery"
    );

    expect(result).toEqual({
      kind: "fragment",
      accessToken: "AAA",
      refreshToken: "RRR",
    });
  });

  it("prefers ?code= when a PKCE code is present", () => {
    const result = parseCallbackCredentials(
      query({ code: "pkce-code" }),
      "access_token=AAA&refresh_token=RRR"
    );

    expect(result).toEqual({ kind: "code", code: "pkce-code" });
  });

  it("accepts token_hash links for the allowlisted types", () => {
    for (const type of ["recovery", "signup", "email_change"]) {
      expect(parseCallbackCredentials(query({ token_hash: "TH", type }), "")).toEqual({
        kind: "token",
        tokenHash: "TH",
        type,
      });
    }
  });

  it("rejects token_hash links for anything outside the allowlist", () => {
    expect(
      parseCallbackCredentials(query({ token_hash: "TH", type: "magiclink" }), "")
    ).toEqual({ kind: "none" });
    expect(parseCallbackCredentials(query({ token_hash: "TH" }), "")).toEqual({
      kind: "none",
    });
  });

  it("treats a fragment without both tokens as no credential", () => {
    expect(parseCallbackCredentials(query({}), "access_token=AAA")).toEqual({
      kind: "none",
    });
    expect(parseCallbackCredentials(query({}), "type=signup")).toEqual({
      kind: "none",
    });
    expect(parseCallbackCredentials(query({}), "")).toEqual({ kind: "none" });
  });

  it("treats an empty landing as no credential (fail closed)", () => {
    expect(parseCallbackCredentials(query({}), "")).toEqual({ kind: "none" });
    expect(parseCallbackCredentials(query({ next: "/dashboard" }), "")).toEqual({
      kind: "none",
    });
  });
});
