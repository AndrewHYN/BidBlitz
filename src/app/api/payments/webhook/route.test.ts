import { afterEach, describe, expect, it } from "vitest";
import {
  PaymentPayloadError,
  PaymentProviderNotConfiguredError,
  PaymentProviderRequestError,
  PaymentSignatureError,
  NoopPaymentProvider,
  setPaymentProvider,
  type ConfirmResult,
  type PaymentProvider,
  type WebhookContext,
} from "@/server/payments/provider";
import { POST } from "./route";

/**
 * The webhook contract, asserted as a whole.
 *
 * The rule that matters most: this route NEVER touches a transaction. It
 * authenticates nothing itself, changes nothing itself — it decides only how
 * a provider's answer is reported, and the provider decides only whether the
 * event was genuine. Every state change lives behind the ledger functions in
 * Postgres.
 */

type Behaviour = (payload: unknown, context?: WebhookContext) => Promise<ConfirmResult>;

function fakeProvider(behaviour: Behaviour): PaymentProvider {
  return {
    capabilities: {
      id: "fake",
      displayName: "Fake provider",
      configured: true,
      currencies: ["USD"],
      supportsCancellation: false,
    },
    async createIntent() {
      throw new Error("not used by the webhook");
    },
    confirm: behaviour,
    async cancel() {
      throw new Error("not used by the webhook");
    },
  };
}

const seen: Array<{ payload: unknown; context?: WebhookContext }> = [];

function post(body: string, contentType?: string): Promise<Response> {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  return POST(
    new Request("http://localhost/api/payments/webhook", {
      method: "POST",
      headers,
      body,
    })
  );
}

async function read(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

afterEach(() => {
  seen.length = 0;
  setPaymentProvider(new NoopPaymentProvider());
});

describe("POST /api/payments/webhook — no provider configured", () => {
  it("answers 503 before it even reads the body", async () => {
    setPaymentProvider(new NoopPaymentProvider());

    const response = await post("");
    expect(response.status).toBe(503);
    expect(await read(response)).toEqual({
      ok: false,
      error: "no_payment_provider",
    });
  });
});

describe("POST /api/payments/webhook — body handling", () => {
  it("rejects an empty body with 400 empty_body", async () => {
    setPaymentProvider(fakeProvider(async () => ({ handled: true })));

    const response = await post("");
    expect(response.status).toBe(400);
    expect(await read(response)).toEqual({ ok: false, error: "empty_body" });
  });

  it("rejects broken JSON with 400 invalid_json", async () => {
    setPaymentProvider(fakeProvider(async () => ({ handled: true })));

    const response = await post('{"status":', "application/json");
    expect(response.status).toBe(400);
    expect(await read(response)).toEqual({ ok: false, error: "invalid_json" });
  });

  it("rejects a body in no recognisable encoding", async () => {
    setPaymentProvider(fakeProvider(async () => ({ handled: true })));

    const response = await post("not a message at all");
    expect(response.status).toBe(400);
    expect(await read(response)).toEqual({
      ok: false,
      error: "unsupported_body",
    });
  });

  it("hands a form-encoded body to the provider with the raw bytes intact", async () => {
    const raw = "reference=abc&amount=10.00&status=Paid";
    setPaymentProvider(
      fakeProvider(async (_payload, context) => {
        seen.push({ payload: _payload, context });
        return { handled: true };
      })
    );

    const response = await post(
      raw,
      "application/x-www-form-urlencoded; charset=UTF-8"
    );

    expect(response.status).toBe(200);
    expect(await read(response)).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    // Byte-for-byte the body that arrived — a signature scheme hashes exactly
    // what was transmitted, so this must never be a re-serialised copy.
    expect(seen[0].context?.rawBody).toBe(raw);
    // Lower-cased header names, as providers look them up.
    expect(seen[0].context?.headers["content-type"]).toContain(
      "application/x-www-form-urlencoded"
    );
  });

  it("hands a JSON body to the provider parsed, alongside the raw bytes", async () => {
    const raw = '{"status":"paid","amount":"10.00"}';
    setPaymentProvider(
      fakeProvider(async (_payload, context) => {
        seen.push({ payload: _payload, context });
        return { handled: true };
      })
    );

    const response = await post(raw, "application/json");
    expect(response.status).toBe(200);
    expect(seen[0].payload).toEqual({ status: "paid", amount: "10.00" });
    expect(seen[0].context?.rawBody).toBe(raw);
  });
});

describe("POST /api/payments/webhook — outcomes", () => {
  it("reports an unrecognised event as 400, not as a success", async () => {
    setPaymentProvider(fakeProvider(async () => ({ handled: false })));

    const response = await post("status=Whatever");
    expect(response.status).toBe(400);
    expect(await read(response)).toEqual({
      ok: false,
      error: "unrecognized_payload",
    });
  });

  it("reports an invalid signature precisely", async () => {
    setPaymentProvider(
      fakeProvider(async () => {
        throw new PaymentSignatureError();
      })
    );

    const response = await post("status=Paid");
    expect(response.status).toBe(400);
    expect(await read(response)).toEqual({
      ok: false,
      error: "invalid_signature",
    });
  });

  it("reports the exact rule that rejected the event", async () => {
    for (const reason of [
      "unknown_transaction",
      "amount_mismatch",
      "invalid_transition",
      "malformed_payload",
    ]) {
      setPaymentProvider(
        fakeProvider(async () => {
          throw new PaymentPayloadError(reason, "rejected");
        })
      );

      const response = await post("status=Paid");
      expect(response.status).toBe(400);
      expect(await read(response)).toEqual({ ok: false, error: reason });
    }
  });

  it("answers 503 when the provider turns out to be unconfigured", async () => {
    setPaymentProvider(
      fakeProvider(async () => {
        throw new PaymentProviderNotConfiguredError();
      })
    );

    const response = await post("status=Paid");
    expect(response.status).toBe(503);
    expect(await read(response)).toEqual({
      ok: false,
      error: "no_payment_provider",
    });
  });

  it("answers 500 for a failure the provider may retry", async () => {
    setPaymentProvider(
      fakeProvider(async () => {
        throw new Error("connection reset by peer");
      })
    );

    const response = await post("status=Paid");
    expect(response.status).toBe(500);
    expect(await read(response)).toEqual({ ok: false, error: "webhook_failed" });
  });

  it("answers 500 when the provider's own API failed", async () => {
    setPaymentProvider(
      fakeProvider(async () => {
        throw new PaymentProviderRequestError("Paynow answered HTTP 503");
      })
    );

    const response = await post("status=Paid");
    expect(response.status).toBe(500);
    expect(await read(response)).toEqual({ ok: false, error: "webhook_failed" });
  });

  it("never returns a body that looks like a payment confirmation", async () => {
    setPaymentProvider(fakeProvider(async () => ({ handled: true })));

    const response = await post("status=Paid");
    const body = await read(response);
    expect(Object.keys(body)).toEqual(["ok"]);
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("paid");
  });
});
