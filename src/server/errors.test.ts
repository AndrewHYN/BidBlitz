import { describe, expect, it } from "vitest";
import { normalizeEngineError, renderRejectionMessage } from "./errors";

describe("normalizeEngineError()", () => {
  it("extracts known codes from raw engine messages", () => {
    expect(normalizeEngineError("seller_cannot_bid")).toMatchObject({
      code: "seller_cannot_bid",
      message: "You can't bid on your own auction.",
    });
    expect(normalizeEngineError("auction_ended")).toMatchObject({
      code: "auction_ended",
      message: "Auction has ended.",
    });
    expect(normalizeEngineError("auction_state_immutable")).toMatchObject({
      code: "auction_state_immutable",
      message: "That change isn't allowed on a live auction.",
    });
    expect(normalizeEngineError("image_required")).toMatchObject({
      code: "image_required",
      message: "Add at least one photo before publishing.",
    });
  });

  it("turns a numeric below_minimum hint into the floor to beat", () => {
    const rejection = normalizeEngineError({ message: "below_minimum", hint: "2550" });
    expect(rejection.code).toBe("below_minimum");
    expect(rejection.nextMinMinor).toBe(2550n);
    expect(rejection.message).toContain("__AMOUNT__");
  });

  it("leaves nextMinMinor unset when the hint is absent or not numeric", () => {
    const withoutHint = normalizeEngineError("below_minimum");
    expect(withoutHint.code).toBe("below_minimum");
    expect(withoutHint.nextMinMinor).toBeUndefined();

    const nonNumeric = normalizeEngineError({
      message: "below_minimum",
      hint: "the floor",
    });
    expect(nonNumeric.nextMinMinor).toBeUndefined();

    const wrongCode = normalizeEngineError({ message: "auction_ended", hint: "123" });
    expect(wrongCode.code).toBe("auction_ended");
    expect(wrongCode.nextMinMinor).toBeUndefined();
  });

  it("maps permission-denied place_bid onto not_authenticated", () => {
    const rejection = normalizeEngineError(
      "permission denied for function place_bid"
    );
    expect(rejection.code).toBe("not_authenticated");
    expect(rejection.message).toBe("Sign in to bid.");
  });

  it("maps rate-limit wording onto rate_limited", () => {
    expect(normalizeEngineError("rate limit exceeded, slow down")).toMatchObject({
      code: "rate_limited",
      message: "Too many attempts. Wait a moment and try again.",
    });
    expect(normalizeEngineError({ message: "rate_limited" })).toMatchObject({
      code: "rate_limited",
      message: "Too many attempts. Wait a moment and try again.",
    });
  });

  it("falls back to the generic copy for unknown text", () => {
    const rejection = normalizeEngineError(
      "something exploded at the connection pool"
    );
    expect(rejection.code).toBe("unknown");
    expect(rejection.message).toBe("Something went wrong. Please try again.");
    expect(rejection.nextMinMinor).toBeUndefined();
  });

  it("reads message fields off error-shaped objects", () => {
    expect(normalizeEngineError({ message: "auction_not_found" }).code).toBe(
      "auction_not_found"
    );
    expect(normalizeEngineError({ error: "invalid_request_id" }).code).toBe(
      "invalid_request_id"
    );
    expect(
      normalizeEngineError({ error_description: "not_authenticated" }).code
    ).toBe("not_authenticated");
    expect(normalizeEngineError(new Error("has_bids")).code).toBe("has_bids");
    expect(normalizeEngineError(null).code).toBe("unknown");
    expect(normalizeEngineError(undefined).code).toBe("unknown");
    expect(normalizeEngineError(42).code).toBe("unknown");
  });
});

describe("renderRejectionMessage()", () => {
  it("substitutes the formatted amount into below_minimum copy", () => {
    const rejection = normalizeEngineError({ message: "below_minimum", hint: "2550" });
    const text = renderRejectionMessage(rejection, (minor) => `$${minor}`);
    expect(text).toBe("Minimum bid is $2550.");
  });

  it("is a no-op when there is no floor to show", () => {
    const rejection = normalizeEngineError("auction_ended");
    expect(renderRejectionMessage(rejection, () => "SHOULD NOT APPEAR")).toBe(
      "Auction has ended."
    );
  });

  it("is a no-op for a below_minimum rejection without a numeric hint", () => {
    const rejection = normalizeEngineError("below_minimum");
    expect(renderRejectionMessage(rejection, () => "SHOULD NOT APPEAR")).toBe(
      "Minimum bid is {amount}."
    );
  });
});
