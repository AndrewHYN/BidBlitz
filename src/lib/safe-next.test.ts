import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext()", () => {
  it("keeps single-slash same-origin paths", () => {
    expect(safeNext("/browse")).toBe("/browse");
    expect(safeNext("/auction/abc")).toBe("/auction/abc");
    expect(safeNext("  /browse  ")).toBe("/browse");
  });

  it("rejects absolute and protocol-relative destinations", () => {
    expect(safeNext("https://evil.com")).toBe("/browse");
    expect(safeNext("http://evil.com/x")).toBe("/browse");
    expect(safeNext("//evil.com")).toBe("/browse");
    expect(safeNext("/\\evil.com")).toBe("/browse");
    expect(safeNext("\\\\evil.com")).toBe("/browse");
    expect(safeNext("javascript:alert(1)")).toBe("/browse");
    expect(safeNext("javascript:alert(1)", "/login")).toBe("/login");
  });

  it("rejects relative and missing values", () => {
    expect(safeNext(undefined)).toBe("/browse");
    expect(safeNext(null)).toBe("/browse");
    expect(safeNext("")).toBe("/browse");
    expect(safeNext("dashboard")).toBe("/browse");
    expect(safeNext("evil.com")).toBe("/browse");
  });

  // The URL parser strips tab/CR/LF before parsing, so "/\t/evil.com" is read
  // as "//evil.com" — a protocol-relative URL off the site. Trimming alone does
  // not remove an inner control character, so these must be rejected outright.
  it("rejects control characters that the URL parser would erase", () => {
    for (const evil of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\u0000x"]) {
      expect(safeNext(evil)).toBe("/browse");
      expect(safeNext(evil)).toBe(safeNext("/browse"));
    }
    expect(new URL(safeNext("/\t/evil.com"), "https://bidblitz.co.zw/login").origin).toBe(
      "https://bidblitz.co.zw"
    );
  });
});
