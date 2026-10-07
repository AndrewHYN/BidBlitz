import { describe, expect, it } from "vitest";
import { normalizeZimbabwePhone } from "./phone";

describe("normalizeZimbabwePhone", () => {
  it.each([
    ["0771234567", "+263771234567"],
    ["+263771234567", "+263771234567"],
    ["263771234567", "+263771234567"],
    ["077 123 4567", "+263771234567"],
    ["(077) 123-4567", "+263771234567"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeZimbabwePhone(input)).toBe(expected);
  });

  it.each(["", "771234567", "+26377123", "01234567890", "+27123456789"])(
    "refuses %s",
    (input) => {
      expect(normalizeZimbabwePhone(input)).toBeNull();
    }
  );
});
