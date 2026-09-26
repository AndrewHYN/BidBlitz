import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { resetRateLimits } from "@/server/rate-limit";
import {
  NoopPaymentProvider,
  PaymentProviderError,
  PaymentProviderRequestError,
  setPaymentProvider,
  type CreateIntentInput,
  type PaymentIntent,
  type PaymentProvider,
} from "@/server/payments/provider";
import { POST } from "./route";

/**
 * Checkout contract.
 *
 * What this route is allowed to do is deliberately narrow: read a transaction
 * the caller already owns (RLS decides), and ask the provider for a payment
 * page. It has no write path to `transactions` at all — PAID is reachable only
 * from the webhook, after the provider has verified a signature.
 *
 * The tests that matter most are the refusals: no session, no such row, not
 * the buyer, not awaiting payment, and — the state BidBlitz actually ships
 * in — no provider configured.
 */

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const TX = "3f1d2a4c-9b8e-4f6a-8c2d-1e5b7a9c0f34";
const BUYER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

type Row = {
  id: string;
  status: string;
  gross_minor: number;
  currency: string;
  buyer_id: string;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: TX,
    status: "AWAITING_PAYMENT",
    gross_minor: 1000,
    currency: "USD",
    buyer_id: BUYER,
    ...overrides,
  };
}

function session(user: { id: string } | null, found: Row | null): void {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: found, error: null }),
        }),
      }),
    }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

function providerWith(
  createIntent: (input: CreateIntentInput) => Promise<PaymentIntent>
): PaymentProvider {
  return {
    capabilities: {
      id: "fake",
      displayName: "Fake provider",
      configured: true,
      currencies: ["USD"],
      supportsCancellation: false,
    },
    createIntent,
    async confirm() {
      return { handled: false };
    },
    async cancel() {
      throw new Error("not used by checkout");
    },
  };
}

let ipCounter = 0;

function post(body: string, ip: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/payments/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body,
    })
  );
}

function postJson(payload: unknown, ip = `10.0.${ipCounter++}.1`): Promise<Response> {
  return post(JSON.stringify(payload), ip);
}

async function read(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  resetRateLimits();
  vi.mocked(createClient).mockReset();
});

afterEach(() => {
  setPaymentProvider(new NoopPaymentProvider());
  resetRateLimits();
});

describe("POST /api/payments/checkout — unconfigured", () => {
  it("answers 503 and never reaches the database", async () => {
    setPaymentProvider(new NoopPaymentProvider());

    const response = await postJson({ transactionId: TX });

    expect(response.status).toBe(503);
    expect(await read(response)).toEqual({
      ok: false,
      error: "no_payment_provider",
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/payments/checkout — request shape", () => {
  beforeEach(() => {
    setPaymentProvider(
      providerWith(async (input) => ({
        id: "pi_1",
        transactionId: input.transactionId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        status: "requires_action",
        redirectUrl: "https://www.paynow.co.zw/Payment/ConfirmPayment/9510",
      }))
    );
  });

  it("rejects a body that is not JSON", async () => {
    const response = await post("not json", "10.1.1.1");
    expect(response.status).toBe(400);
    expect(await read(response)).toEqual({ ok: false, error: "invalid_request" });
  });

  it("rejects a missing or malformed transaction id", async () => {
    for (const payload of [{}, { transactionId: "invoice-1" }, { transactionId: 42 }]) {
      const response = await postJson(payload);
      expect(response.status).toBe(400);
      expect(await read(response)).toEqual({
        ok: false,
        error: "invalid_request",
      });
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller before reading anything", async () => {
    session(null, null);

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(401);
    expect(await read(response)).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("rate limits repeated attempts", async () => {
    const ip = "10.9.9.9";
    session(null, null);
    let last: Response | undefined;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      last = await postJson({ transactionId: TX }, ip);
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    const body = await read(last as Response);
    expect(body).toEqual({ ok: false, error: "rate_limited" });
  });
});

describe("POST /api/payments/checkout — authorisation and state", () => {
  beforeEach(() => {
    setPaymentProvider(
      providerWith(async (input) => ({
        id: "pi_1",
        transactionId: input.transactionId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        status: "requires_action",
        redirectUrl: "https://www.paynow.co.zw/Payment/ConfirmPayment/9510",
      }))
    );
  });

  it("answers 404 for a transaction the caller cannot see", async () => {
    // RLS hides rows the caller is not a party to: the query simply returns
    // nothing, and a stranger learns only that it does not exist for them.
    session({ id: BUYER }, null);

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(404);
    expect(await read(response)).toEqual({
      ok: false,
      error: "transaction_not_found",
    });
  });

  it("refuses anyone who is not the buyer", async () => {
    session({ id: "99999999-9999-9999-9999-999999999999" }, row());

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(403);
    expect(await read(response)).toEqual({ ok: false, error: "not_the_buyer" });
  });

  it("refuses a sale that is not awaiting payment", async () => {
    for (const status of ["PAID", "SETTLED", "REFUNDED", "FAILED"]) {
      session({ id: BUYER }, row({ status }));
      const response = await postJson({ transactionId: TX });
      expect(response.status).toBe(409);
      expect(await read(response)).toEqual({
        ok: false,
        error: "not_awaiting_payment",
      });
    }
  });

  it("reports a database failure instead of guessing", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: async () => ({ data: { user: { id: BUYER } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: "connection lost" },
            }),
          }),
        }),
      }),
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(500);
    expect(await read(response)).toEqual({ ok: false, error: "checkout_failed" });
  });
});

describe("POST /api/payments/checkout — starting a payment", () => {
  it("returns the provider's payment page and claims nothing else", async () => {
    const seen: CreateIntentInput[] = [];
    session({ id: BUYER }, row());
    setPaymentProvider(
      providerWith(async (input) => {
        seen.push(input);
        return {
          id: "poll-url",
          transactionId: input.transactionId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          status: "requires_action",
          redirectUrl: "https://www.paynow.co.zw/Payment/ConfirmPayment/9510",
        };
      })
    );

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(200);

    const body = await read(response);
    expect(body).toEqual({
      ok: true,
      provider: "fake",
      transactionId: TX,
      redirectUrl: "https://www.paynow.co.zw/Payment/ConfirmPayment/9510",
    });
    // A response must never imply the sale is settled: it is an invitation to
    // go and pay, nothing more.
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("paid");

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      transactionId: TX,
      amountMinor: 1000n,
      currency: "USD",
      idempotencyKey: `checkout:${TX}`,
    });
  });

  it("charges the amount on the record, never a client-supplied one", async () => {
    const seen: CreateIntentInput[] = [];
    session({ id: BUYER }, row({ gross_minor: 250_000 }));
    setPaymentProvider(
      providerWith(async (input) => {
        seen.push(input);
        return {
          id: "poll-url",
          transactionId: input.transactionId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          status: "requires_action",
          redirectUrl: "https://example.test/pay",
        };
      })
    );

    // The caller only ever sends the id; the price comes from the row.
    await postJson({ transactionId: TX, amountMinor: 1 });
    expect(seen[0].amountMinor).toBe(250_000n);
  });

  it("turns a provider refusal into a 502, not a success", async () => {
    session({ id: BUYER }, row());
    setPaymentProvider(
      providerWith(async () => {
        throw new PaymentProviderRequestError("Paynow answered HTTP 503");
      })
    );

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(502);
    expect(await read(response)).toEqual({ ok: false, error: "provider_error" });
  });

  it("turns an unsupported currency into a 400 the buyer can read", async () => {
    session({ id: BUYER }, row({ currency: "EUR" }));
    setPaymentProvider(
      providerWith(async () => {
        throw new PaymentProviderError(
          "PAYMENT_UNSUPPORTED_CURRENCY",
          "Paynow settles in USD."
        );
      })
    );

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(400);
    expect(await read(response)).toEqual({
      ok: false,
      error: "unsupported_currency",
    });
  });

  it("answers 502 when the provider hands back no payment page", async () => {
    session({ id: BUYER }, row());
    setPaymentProvider(
      providerWith(async (input) => ({
        id: "pi_1",
        transactionId: input.transactionId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        status: "requires_action",
      }))
    );

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(502);
    expect(await read(response)).toEqual({ ok: false, error: "provider_error" });
  });
});
