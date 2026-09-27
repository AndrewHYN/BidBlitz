import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { resetRateLimits } from "@/server/rate-limit";
import {
  NoopPaymentProvider,
  PaymentPayloadError,
  PaymentProviderError,
  PaymentProviderRequestError,
  PaymentSignatureError,
  setPaymentProvider,
  type PaymentProvider,
  type ReconcileInput,
  type ReconcileResult,
} from "@/server/payments/provider";
import { POST } from "./route";

/**
 * Reconciliation contract.
 *
 * The test that matters most is the forgery one: the request body is where a
 * buyer would put `status: "Paid"` if this route believed the browser. It
 * does not — the only thing read from the request is the transaction id, and
 * every value handed to the provider comes from the row Postgres returned.
 *
 * The second most important is that a transaction which is no longer waiting
 * for money is answered from Postgres alone: no provider call, no network,
 * no chance of downgrading PAID by asking again.
 */

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const TX = "3f1d2a4c-9b8e-4f6a-8c2d-1e5b7a9c0f34";
const BUYER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SELLER = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";

type Row = {
  id: string;
  status: string;
  gross_minor: number;
  currency: string;
  buyer_id: string;
  seller_id: string;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: TX,
    status: "AWAITING_PAYMENT",
    gross_minor: 1000,
    currency: "USD",
    buyer_id: BUYER,
    seller_id: SELLER,
    ...overrides,
  };
}

/**
 * A single element is returned for every read (the row as it stands); a list
 * is a queue, so a test can show the status changing between the read that
 * authorises the check and the read that reports the answer.
 */
function session(
  user: { id: string } | null,
  found: Row | null | Array<Row | null>
): void {
  const queue: Array<Row | null> = Array.isArray(found) ? [...found] : [found];
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: queue.length > 1 ? (queue.shift() as Row | null) : queue[0],
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

function providerWith(
  reconcile: (input: ReconcileInput) => Promise<ReconcileResult>
): PaymentProvider {
  return {
    capabilities: {
      id: "fake",
      displayName: "Fake provider",
      configured: true,
      currencies: ["USD"],
      supportsCancellation: false,
    },
    async createIntent() {
      throw new Error("not used by reconcile");
    },
    async confirm() {
      return { handled: false };
    },
    reconcile,
    async cancel() {
      throw new Error("not used by reconcile");
    },
  };
}

let ipCounter = 0;
const seen: ReconcileInput[] = [];

function postJson(payload: unknown, ip = `10.2.${ipCounter++}.1`): Promise<Response> {
  return POST(
    new Request("http://localhost/api/payments/reconcile", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    })
  );
}

async function read(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  resetRateLimits();
  vi.mocked(createClient).mockReset();
  seen.length = 0;
});

afterEach(() => {
  setPaymentProvider(new NoopPaymentProvider());
  resetRateLimits();
});

describe("POST /api/payments/reconcile — no provider configured", () => {
  it("answers 503 before it even reads the body", async () => {
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

describe("POST /api/payments/reconcile — request shape", () => {
  beforeEach(() => {
    setPaymentProvider(
      providerWith(async (input) => {
        seen.push(input);
        return { providerStatus: "Paid", outcome: "paid", applied: true };
      })
    );
  });

  it("rejects a body that is not JSON", async () => {
    const response = await postJson("not json");
    expect(response.status).toBe(400);
    expect(await read(response)).toEqual({ ok: false, error: "invalid_request" });
  });

  it("rejects a missing or malformed transaction id", async () => {
    for (const payload of [{}, { transactionId: "invoice-1" }, { transactionId: 42 }]) {
      const response = await postJson(payload);
      expect(response.status).toBe(400);
      expect(await read(response)).toEqual({ ok: false, error: "invalid_request" });
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller before reading anything", async () => {
    session(null, null);

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(401);
    expect(await read(response)).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("rate limits repeated checks", async () => {
    const ip = "10.8.8.8";
    session(null, null);
    let last: Response | undefined;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      last = await postJson({ transactionId: TX }, ip);
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    expect(await read(last as Response)).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });
});

describe("POST /api/payments/reconcile — authorisation and state", () => {
  beforeEach(() => {
    setPaymentProvider(
      providerWith(async (input) => {
        seen.push(input);
        return { providerStatus: "Paid", outcome: "paid", applied: true };
      })
    );
  });

  it("answers 404 for a transaction the caller cannot see", async () => {
    // RLS hides rows the caller is not a party to: the query returns nothing.
    session({ id: "99999999-9999-9999-9999-999999999999" }, null);

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(404);
    expect(await read(response)).toEqual({
      ok: false,
      error: "transaction_not_found",
    });
    expect(seen).toHaveLength(0);
  });

  it("answers 403 for a signed-in stranger to the sale", async () => {
    session({ id: "99999999-9999-9999-9999-999999999999" }, row());

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(403);
    expect(await read(response)).toEqual({ ok: false, error: "not_a_party" });
    expect(seen).toHaveLength(0);
  });

  it("answers 200 from Postgres alone when the sale is no longer pending", async () => {
    for (const status of ["PAID", "SETTLED", "FAILED", "REFUNDED"]) {
      session({ id: BUYER }, row({ status }));

      const response = await postJson({ transactionId: TX });

      expect(response.status).toBe(200);
      expect(await read(response)).toEqual({
        ok: true,
        status,
        reconciled: false,
        reason: "already_final",
      });
    }
    // PAID is never re-opened, and no request is made to ask a provider about
    // a row the database has already settled.
    expect(seen).toHaveLength(0);
  });

  it("checks a sale the seller is waiting on too", async () => {
    session({ id: SELLER }, row());

    const response = await postJson({ transactionId: TX });

    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
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
    expect(await read(response)).toEqual({ ok: false, error: "reconcile_failed" });
  });
});

describe("POST /api/payments/reconcile — the browser supplies no status", () => {
  it("ignores a claimed Paid/amount in the body and reports the row", async () => {
    session({ id: BUYER }, [row(), row()]);
    setPaymentProvider(
      providerWith(async (input) => {
        seen.push(input);
        // Paynow still has not confirmed: the transaction stays put.
        return { providerStatus: "Created", outcome: "noted", applied: false };
      })
    );

    const response = await postJson({
      transactionId: TX,
      status: "Paid",
      paid: true,
      amount: "10.00",
      amountMinor: 999_999,
      currency: "ZWG",
      provider: "paynow",
    });

    expect(response.status).toBe(200);
    const body = await read(response);
    // The answer is the re-read row, not the buyer's claim.
    expect(body).toEqual({
      ok: true,
      status: "AWAITING_PAYMENT",
      reconciled: true,
      outcome: "noted",
      providerStatus: "Created",
      changed: false,
    });

    // And every value the provider was given came from Postgres.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      transactionId: TX,
      amountMinor: 1000n,
      currency: "USD",
    });
  });

  it("reports a confirmed payment as the database now has it", async () => {
    // Read 1: still waiting. Read 2 (after the provider ran): PAID.
    session({ id: BUYER }, [row(), row({ status: "PAID" })]);
    setPaymentProvider(
      providerWith(async (input) => {
        seen.push(input);
        return { providerStatus: "Paid", outcome: "paid", applied: true };
      })
    );

    const response = await postJson({ transactionId: TX, status: "Cancelled" });

    expect(response.status).toBe(200);
    expect(await read(response)).toEqual({
      ok: true,
      status: "PAID",
      reconciled: true,
      outcome: "paid",
      providerStatus: "Paid",
      changed: true,
    });
    expect(seen[0].amountMinor).toBe(1000n);
  });
});

describe("POST /api/payments/reconcile — provider answers", () => {
  it("reports an unverifiable reply as 400 invalid_signature", async () => {
    session({ id: BUYER }, row());
    setPaymentProvider(
      providerWith(async () => {
        throw new PaymentSignatureError();
      })
    );

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(400);
    expect(await read(response)).toEqual({
      ok: false,
      error: "invalid_signature",
    });
  });

  it("reports the exact rule that refused the reply", async () => {
    for (const reason of [
      "amount_mismatch",
      "reference_mismatch",
      "currency_mismatch",
      "no_poll_url",
      "invalid_poll_url",
      "unrecognized_payload",
    ]) {
      session({ id: BUYER }, row());
      setPaymentProvider(
        providerWith(async () => {
          throw new PaymentPayloadError(reason, "refused");
        })
      );

      const response = await postJson({ transactionId: TX });
      expect(response.status).toBe(400);
      expect(await read(response)).toEqual({ ok: false, error: reason });
    }
  });

  it("answers 502 and changes nothing when Paynow cannot be reached", async () => {
    session({ id: BUYER }, row());
    setPaymentProvider(
      providerWith(async () => {
        throw new PaymentProviderRequestError("Could not reach Paynow: timeout");
      })
    );

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(502);
    expect(await read(response)).toEqual({
      ok: false,
      error: "provider_unreachable",
    });
  });

  it("answers 500 for a failure nobody can classify", async () => {
    session({ id: BUYER }, row());
    setPaymentProvider(
      providerWith(async () => {
        throw new Error("connection reset by peer");
      })
    );

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(500);
    expect(await read(response)).toEqual({ ok: false, error: "reconcile_failed" });
  });

  it("answers 501 when the configured provider has no status endpoint", async () => {
    session({ id: BUYER }, row());
    const provider = providerWith(async () => ({
      providerStatus: null,
      outcome: "noted",
      applied: false,
    }));
    delete provider.reconcile;
    setPaymentProvider(provider);

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(501);
    expect(await read(response)).toEqual({
      ok: false,
      error: "reconciliation_unsupported",
    });
  });

  it("never returns a body that could be read as a confirmation on failure", async () => {
    session({ id: BUYER }, row());
    setPaymentProvider(
      providerWith(async () => {
        throw new PaymentProviderRequestError("timeout");
      })
    );

    const body = await read(await postJson({ transactionId: TX }));
    expect(Object.keys(body)).toEqual(["ok", "error"]);
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("paid");
  });

  it("classifies any other provider failure as 502, never as a success", async () => {
    session({ id: BUYER }, row());
    setPaymentProvider(
      providerWith(async () => {
        throw new PaymentProviderError("PAYMENT_LEDGER_FAILED", "insert failed");
      })
    );

    const response = await postJson({ transactionId: TX });
    expect(response.status).toBe(502);
    expect(await read(response)).toEqual({ ok: false, error: "provider_error" });
  });
});
