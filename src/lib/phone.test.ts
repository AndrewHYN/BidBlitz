import { describe, expect, it } from "vitest";
import { normalizeZimbabwePhone, normalizeListingContactPhone } from "./phone";

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

describe("international listing contact numbers", () => {
  it.each([
    ["077 123 4567", "+263771234567"],
    ["263771234567", "+263771234567"],
    ["+27 82 123 4567", "+27821234567"],
    ["0027 (82) 123-4567", "+27821234567"],
    ["+268 78 123 456", "+26878123456"],
    ["+44 7700 900123", "+447700900123"],
    ["+1 (202) 555-0123", "+12025550123"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeListingContactPhone(input)).toBe(expected);
  });

  it.each(["", "821234567", "+27abc1234567", "+0123456789", "+27", "+1234567890123456", "+27+821234567", "tel:+27821234567"])("rejects %s", (input) => {
    expect(normalizeListingContactPhone(input)).toBeNull();
  });
});
