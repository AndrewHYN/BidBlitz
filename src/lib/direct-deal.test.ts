import { describe, expect, it } from "vitest";
import {
  composeServiceRequest, customOfferMinor, saleOfferPresets,
} from "./direct-deal";

describe("fixed price Sale offers", () => {
  it("matches screenshot-style 10% below, asking and 5% above presets", () => {
    expect(saleOfferPresets(16000n).map(({ id, minor }) => ({ id, minor }))).toEqual([
      { id: "below", minor: 14400n },
      { id: "asking", minor: 16000n },
      { id: "above", minor: 16800n },
    ]);
  });

  it("uses integer-cent rounding without floating-point price errors", () => {
    expect(saleOfferPresets(10001n).map(item => item.minor)).toEqual([9001n, 10001n, 10501n]);
  });

  it("prevents offers below $1, above SQL limits or fractional cents", () => {
    expect(customOfferMinor("0.99")).toBeNull();
    expect(customOfferMinor("75.555")).toBeNull();
    expect(customOfferMinor("not money")).toBeNull();
    expect(customOfferMinor("9999999999999999")).toBeNull();
    expect(customOfferMinor("$1,234.50")).toBe(123450n);
    expect(saleOfferPresets(100n).map(x => x.id)).toEqual(["asking", "above"]);
  });
});

describe("Service enquiries", () => {
  it("keeps optional requirements and budget in one existing hire-request body", () => {
    expect(composeServiceRequest({
      description: "I need my gaming computer repaired.",
      preferredDate: "2026-12-04", location: "Avondale, Harare", budget: "75",
      currency: "USD",
    })).toEqual(
      "I need my gaming computer repaired.\n\nPreferred date: 2026-12-04\n\nService location: Avondale, Harare\n\nSuggested budget (not a payment or fixed quote): $75.00"
    );
  });

  it("allows requests with no optional fields", () => {
    expect(composeServiceRequest({ description: "Repair a laptop screen" })).toBe("Repair a laptop screen");
  });

  it("rejects overlong, short, invalid date and invalid budget submissions", () => {
    expect(composeServiceRequest({ description: "Too short" })).toBeNull();
    expect(composeServiceRequest({ description: "x".repeat(1501) })).toBeNull();
    expect(composeServiceRequest({ description: "Repair my laptop.", preferredDate: "tomorrow" })).toBeNull();
    expect(composeServiceRequest({ description: "Repair my laptop.", preferredDate: "2026-02-30" })).toBeNull();
    expect(composeServiceRequest({ description: "Repair my laptop.", location: "x".repeat(121) })).toBeNull();
    expect(composeServiceRequest({ description: "Repair my laptop.", budget: "0.50" })).toBeNull();
  });
});
