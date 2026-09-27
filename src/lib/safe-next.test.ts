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
});
