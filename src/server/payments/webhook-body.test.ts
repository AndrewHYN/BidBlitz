import { describe, expect, it } from "vitest";
import { precheckWebhookBody } from "./webhook-body";

/**
 * The webhook body pre-check answers one question only: can this body be
 * read, and in which encoding. Authentication is not its job — that happens
 * inside `PaymentProvider.confirm()`, over the raw bytes.
 */
describe("precheckWebhookBody", () => {
  it("names an empty body", () => {
    expect(precheckWebhookBody("")).toEqual({ ok: false, error: "empty_body" });
    expect(precheckWebhookBody("   \n")).toEqual({
      ok: false,
      error: "empty_body",
    });
  });

  it("accepts a JSON object and hands it back parsed", () => {
    const verdict = precheckWebhookBody('{"status":"paid","amount":"10.00"}');
    expect(verdict).toEqual({
      ok: true,
      payload: { status: "paid", amount: "10.00" },
    });
  });

  it("distinguishes broken JSON from a body that is not JSON at all", () => {
    expect(precheckWebhookBody('{"status":')).toEqual({
      ok: false,
      error: "invalid_json",
    });
    expect(precheckWebhookBody('{"status":"paid"} trailing')).toEqual({
      ok: false,
      error: "invalid_json",
    });
    expect(precheckWebhookBody("just words")).toEqual({
      ok: false,
      error: "unsupported_body",
    });
    expect(precheckWebhookBody('"a bare string"')).toEqual({
      ok: false,
      error: "unsupported_body",
    });
  });

  it("refuses a JSON container that is not an object", () => {
    expect(precheckWebhookBody("[1,2,3]")).toEqual({
      ok: false,
      error: "unsupported_body",
    });
    expect(precheckWebhookBody("null")).toEqual({
      ok: false,
      error: "unsupported_body",
    });
  });

  it("accepts the form encoding Paynow actually posts", () => {
    const verdict = precheckWebhookBody(
      "reference=abc&amount=10.00&status=Paid"
    );
    expect(verdict).toEqual({
      ok: true,
      payload: { reference: "abc", amount: "10.00", status: "Paid" },
    });
  });

  it("decodes form values the way the provider will", () => {
    expect(precheckWebhookBody("status=Awaiting+Delivery")).toEqual({
      ok: true,
      payload: { status: "Awaiting Delivery" },
    });
  });

  it("refuses a body in no recognisable encoding", () => {
    expect(precheckWebhookBody("<html><body>nope</body></html>")).toEqual({
      ok: false,
      error: "unsupported_body",
    });
  });
});
