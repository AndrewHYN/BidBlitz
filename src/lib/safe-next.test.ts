import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext()", () => {
  it("keeps single-slash same-origin paths", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/auction/abc")).toBe("/auction/abc");
    expect(safeNext("  /browse  ")).toBe("/browse");
  });

  it("rejects absolute and protocol-relative destinations", () => {
    expect(safeNext("https://evil.com")).toBe("/dashboard");
    expect(safeNext("http://evil.com/x")).toBe("/dashboard");
    expect(safeNext("//evil.com")).toBe("/dashboard");
    expect(safeNext("/\\evil.com")).toBe("/dashboard");
    expect(safeNext("\\\\evil.com")).toBe("/dashboard");
    expect(safeNext("javascript:alert(1)")).toBe("/dashboard");
    expect(safeNext("javascript:alert(1)", "/login")).toBe("/login");
  });

  it("rejects relative and missing values", () => {
    expect(safeNext(undefined)).toBe("/dashboard");
    expect(safeNext(null)).toBe("/dashboard");
    expect(safeNext("")).toBe("/dashboard");
    expect(safeNext("dashboard")).toBe("/dashboard");
    expect(safeNext("evil.com")).toBe("/dashboard");
  });

  // The URL parser strips tab/CR/LF before parsing, so "/\t/evil.com" is read
  // as "//evil.com" — a protocol-relative URL off the site. Trimming alone does
  // not remove an inner control character, so these must be rejected outright.
  it("rejects control characters that the URL parser would erase", () => {
    for (const evil of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\u0000x"]) {
      expect(safeNext(evil)).toBe("/dashboard");
      expect(safeNext(evil)).toBe(safeNext("/dashboard"));
    }
    expect(new URL(safeNext("/\t/evil.com"), "https://bidblitz.co.zw/login").origin).toBe(
      "https://bidblitz.co.zw"
    );
  });
});
