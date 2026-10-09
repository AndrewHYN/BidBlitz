import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LinkwaPaymentProvider,
  isLinkwaBaseUrl,
  linkwaAmountToMinor,
  linkwaEventId,
  linkwaRefusalIndicatesBelowMinimum,
  minorToLinkwaAmount,
  verifyLinkwaSignature,
  LINKWA_PROVIDER_ID,
  type LinkwaConfig,
} from "./linkwa";
import {
  instructLinkwaPayout,
  fetchLinkwaBalance,
  fetchLinkwaStatement,
  linkLinkwaUser,
  registerLinkwaWallet,
} from "./linkwa-payouts";
import {
  PaymentPayloadError,
  PaymentProviderError,
  PaymentSignatureError,
  PaymentUnsupportedOperationError,
} from "./provider";
import type {
  MarkFailedInput,
  MarkPaidInput,
  MarkRefundedInput,
  PaymentIntentRecord,
  PaymentLedger,
  RecordEventInput,
  RecordIntentInput,
} from "./ledger";

const TX = "3f1d2a4c-9b8e-4f6a-8c2d-1e5b7a9c0f34";
const SECRET = "whsec-test-secret";
const BASE = "https://sandbox.linkwa.example";
const LINK_ID = "01ktpcws7840j4k4swyg3zbxgn";

type StubLedger = PaymentLedger & {
  paid: MarkPaidInput[];
  events: RecordEventInput[];
  intents: Record<string, PaymentIntentRecord>;
  byReference: Record<string, string>;
};

function stubLedger(): StubLedger {
  const ledger: StubLedger = {
    paid: [],
    events: [],
    intents: {},
    byReference: {},
    async markPaid(input) {
      ledger.paid.push(input);
      return { alreadyPaid: false };
    },
    async markFailed(input: MarkFailedInput) {
      void input;
      return { alreadyFailed: false };
    },
    async markRefunded(input: MarkRefundedInput) {
      void input;
      return { alreadyRefunded: false };
    },
    async recordEvent(input) {
      ledger.events.push(input);
    },
    async recordIntent(input: RecordIntentInput) {
      ledger.intents[input.transactionId] = {
        transactionId: input.transactionId,
        provider: input.provider,
        pollUrl: input.pollUrl,
        browserUrl: input.browserUrl ?? null,
        providerReference: input.providerReference ?? null,
      };
      if (input.providerReference) {
        ledger.byReference[`${input.provider}:${input.providerReference}`] = input.transactionId;
      }
    },
    async readIntent(transactionId) {
      return ledger.intents[transactionId] ?? null;
    },
    async findTransactionByProviderReference(provider, reference) {
      return ledger.byReference[`${provider}:${reference}`] ?? null;
    },
  };
  return ledger;
}

function providerWith(
  ledger: PaymentLedger,
  fetchImpl?: typeof fetch,
  overrides?: Partial<LinkwaConfig>
): LinkwaPaymentProvider {
  return new LinkwaPaymentProvider({
    apiKey: "sk_live_test",
    baseUrl: BASE,
    webhookSecret: SECRET,
    returnUrl: "https://bidblitz.co.zw/dashboard/transactions",
    ledger,
    fetchImpl,
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Sign a raw webhook body exactly as Linkwa documents. */
function signed(rawBody: string, secret = SECRET): Record<string, string> {
  return {
    "x-linkwa-signature": createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"),
  };
}

function paidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    payment_link_name: "BidBlitz auction payment",
    status: "PAID",
    reference: "PAY-123",
    receipt_id: "REC-456",
    amount: 25.0,
    currency: "USD",
    external_payment_link_id: LINK_ID,
    checkout_url: "https://linkwa.com/pay/abc",
    payment_date_time: "2026-01-01T21:08:56.548172Z",
    ...overrides,
  };
}

describe("Linkwa amounts", () => {
  it("serialises minor units to exact two-decimal strings", () => {
    expect(minorToLinkwaAmount(1999n)).toBe("19.99");
    expect(minorToLinkwaAmount(2500n)).toBe("25.00");
    expect(minorToLinkwaAmount(1n)).toBe("0.01");
  });

  it("refuses zero and negative amounts before any request", () => {
    expect(() => minorToLinkwaAmount(0n)).toThrow(PaymentProviderError);
    expect(() => minorToLinkwaAmount(-5n)).toThrow(PaymentProviderError);
  });

  it("parses documented JSON numbers back to exact cents", () => {
    expect(linkwaAmountToMinor(25.0)).toBe(2500n);
    expect(linkwaAmountToMinor(19.99)).toBe(1999n);
    expect(linkwaAmountToMinor("10.50")).toBe(1050n);
  });

  it("refuses amounts that are not exact cents instead of rounding", () => {
    for (const bad of ["25", "25.0", "25.001", "abc", "", null, undefined, NaN, Infinity]) {
      expect(() => linkwaAmountToMinor(bad), JSON.stringify(bad)).toThrow(PaymentPayloadError);
    }
  });
});

describe("Linkwa webhook authentication", () => {
  it("accepts the documented HMAC-SHA256 of the raw body", () => {
    const raw = JSON.stringify(paidBody());
    expect(() =>
      verifyLinkwaSignature(raw, signed(raw)["x-linkwa-signature"], SECRET)
    ).not.toThrow();
  });

  it("rejects a signature made with another secret", () => {
    const raw = JSON.stringify(paidBody());
    expect(() =>
      verifyLinkwaSignature(raw, signed(raw, "wrong-secret")["x-linkwa-signature"], SECRET)
    ).toThrow(PaymentSignatureError);
  });

  it("rejects a tampered body under the original signature", () => {
    const raw = JSON.stringify(paidBody());
    const tampered = JSON.stringify(paidBody({ amount: 1.0 }));
    expect(() => verifyLinkwaSignature(tampered, signed(raw)["x-linkwa-signature"], SECRET)).toThrow(
      PaymentSignatureError
    );
  });

  it("rejects a missing signature", () => {
    expect(() => verifyLinkwaSignature("{}", null, SECRET)).toThrow(PaymentSignatureError);
  });
});

describe("linkwaEventId", () => {
  it("is stable per delivery and distinct per attempt and status", () => {
    expect(linkwaEventId(LINK_ID, "REC-1", "PAID")).toBe(linkwaEventId(LINK_ID, "REC-1", "PAID"));
    expect(linkwaEventId(LINK_ID, "REC-1", "PAID")).not.toBe(
      linkwaEventId(LINK_ID, "REC-2", "PAID")
    );
  });
});

describe("LinkwaPaymentProvider configuration", () => {
  it("refuses to construct without key, https origin and webhook secret", () => {
    const ledger = stubLedger();
    expect(
      () =>
        new LinkwaPaymentProvider({
          apiKey: "",
          baseUrl: BASE,
          webhookSecret: SECRET,
          returnUrl: "https://bidblitz.co.zw/dashboard/transactions",
          ledger,
        })
    ).toThrow(PaymentProviderError);
    expect(() =>
      providerWith(ledger, undefined, { baseUrl: "http://insecure.example" })
    ).toThrow(PaymentProviderError);
    expect(() =>
      providerWith(ledger, undefined, { webhookSecret: "" })
    ).toThrow(PaymentProviderError);
  });

  it("describes itself truthfully, with no cancellation support", () => {
    const provider = providerWith(stubLedger());
    expect(provider.capabilities).toMatchObject({
      id: LINKWA_PROVIDER_ID,
      displayName: "Linkwa",
      configured: true,
      currencies: ["USD"],
      supportsCancellation: false,
    });
  });

  it("validates base URLs strictly", () => {
    expect(isLinkwaBaseUrl("https://sandbox.linkwa.example")).toBe(true);
    expect(isLinkwaBaseUrl("http://insecure.example")).toBe(false);
    expect(isLinkwaBaseUrl("not a url")).toBe(false);
    expect(isLinkwaBaseUrl("")).toBe(false);
  });

  it("refuses cancellation instead of pretending", async () => {
    await expect(providerWith(stubLedger()).cancel(TX)).rejects.toThrow(
      PaymentUnsupportedOperationError
    );
  });
});

describe("LinkwaPaymentProvider.createIntent", () => {
  function okFetch(calls: Array<{ url: string; body: Record<string, unknown> }>) {
    return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({ url: String(url), body });
      return jsonResponse({
        product: {
          checkout_url: "https://linkwa.com/pay/abc",
          external_payment_link_id: LINK_ID,
        },
      });
    };
  }

  it("posts a signed payment link and stores the traceable session", async () => {
    const ledger = stubLedger();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const intent = await providerWith(ledger, okFetch(calls) as typeof fetch).createIntent({
      transactionId: TX,
      amountMinor: 2500n,
      currency: "USD",
      idempotencyKey: `checkout:${TX}`,
    });

    expect(intent.redirectUrl).toBe("https://linkwa.com/pay/abc");
    expect(intent.providerReference).toBe(LINK_ID);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/api/v1/third-party/payment-links`);
    expect(calls[0].body).toMatchObject({
      amount: 25,
      currency_code: "USD",
      return_url: "https://bidblitz.co.zw/dashboard/transactions",
    });
    // The stored intent is what later ties the webhook back to this sale.
    expect(ledger.intents[TX]?.providerReference).toBe(LINK_ID);
  });

  it("re-enters checkout on the recorded link instead of minting a sibling", async () => {
    const ledger = stubLedger();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const provider = providerWith(ledger, okFetch(calls) as typeof fetch);
    const first = await provider.createIntent({
      transactionId: TX,
      amountMinor: 2500n,
      currency: "USD",
      idempotencyKey: `checkout:${TX}`,
    });
    const second = await provider.createIntent({
      transactionId: TX,
      amountMinor: 2500n,
      currency: "USD",
      idempotencyKey: `checkout:${TX}`,
    });
    expect(calls).toHaveLength(1);
    expect(second.redirectUrl).toBe(first.redirectUrl);
  });

  it("refuses a currency Linkwa does not settle for this integration", async () => {
    await expect(
      providerWith(stubLedger()).createIntent({
        transactionId: TX,
        amountMinor: 100n,
        currency: "EUR",
        idempotencyKey: "x",
      })
    ).rejects.toThrow(PaymentProviderError);
  });

  it("refuses a reference that is not one of our transactions", async () => {
    await expect(
      providerWith(stubLedger()).createIntent({
        transactionId: "not-a-uuid",
        amountMinor: 100n,
        currency: "USD",
        idempotencyKey: "x",
      })
    ).rejects.toThrow(PaymentPayloadError);
  });

  it("fails loudly when Linkwa returns no payment page", async () => {
    const fetchImpl = (async () => jsonResponse({ product: {} })) as typeof fetch;
    await expect(
      providerWith(stubLedger(), fetchImpl).createIntent({
        transactionId: TX,
        amountMinor: 100n,
        currency: "USD",
        idempotencyKey: "x",
      })
    ).rejects.toThrow(/did not return a payment page/);
  });

  it("maps a clear minimum-amount refusal to PAYMENT_AMOUNT_BELOW_MINIMUM", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { message: "Amount must be at least the minimum payment of $1.00" },
        400
      )) as typeof fetch;
    const err = await providerWith(stubLedger(), fetchImpl)
      .createIntent({
        transactionId: TX,
        amountMinor: 50n,
        currency: "USD",
        idempotencyKey: "x",
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect((err as PaymentProviderError).code).toBe("PAYMENT_AMOUNT_BELOW_MINIMUM");
  });

  it("keeps an unrelated provider refusal generic", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ message: "Invalid API key" }, 401)) as typeof fetch;
    await expect(
      providerWith(stubLedger(), fetchImpl).createIntent({
        transactionId: TX,
        amountMinor: 50n,
        currency: "USD",
        idempotencyKey: "x",
      })
    ).rejects.toThrow(/answered HTTP 401/);
  });

  it("only names the minimum when the refusal clearly indicates it", () => {
    expect(
      linkwaRefusalIndicatesBelowMinimum(
        '{"message":"Amount is below the minimum of $1.00"}'
      )
    ).toBe(true);
    expect(linkwaRefusalIndicatesBelowMinimum('{"message":"Bad API key"}')).toBe(false);
    expect(linkwaRefusalIndicatesBelowMinimum("")).toBe(false);
    // No "floor" words -> no guess, even if the amount is mentioned.
    expect(
      linkwaRefusalIndicatesBelowMinimum('{"message":"Amount could not be parsed"}')
    ).toBe(false);
  });

  it("reports a transport failure without touching the ledger", async () => {
    const ledger = stubLedger();
    const fetchImpl = (async () => {
      throw new Error("socket hangup");
    }) as typeof fetch;
    await expect(
      providerWith(ledger, fetchImpl).createIntent({
        transactionId: TX,
        amountMinor: 100n,
        currency: "USD",
        idempotencyKey: "x",
      })
    ).rejects.toThrow(/Could not reach Linkwa/);
    expect(Object.keys(ledger.intents)).toHaveLength(0);
  });
});

describe("LinkwaPaymentProvider.confirm", () => {
  async function setupPaid() {
    const ledger = stubLedger();
    ledger.byReference[`${LINKWA_PROVIDER_ID}:${LINK_ID}`] = TX;
    return ledger;
  }

  it("marks PAID with the exact amount through the recorded link", async () => {
    const ledger = await setupPaid();
    const raw = JSON.stringify(paidBody());
    const result = await providerWith(ledger).confirm({}, { rawBody: raw, headers: signed(raw) });

    expect(result).toEqual({ handled: true });
    expect(ledger.paid).toHaveLength(1);
    expect(ledger.paid[0]).toMatchObject({
      transactionId: TX,
      provider: LINKWA_PROVIDER_ID,
      amountMinor: 2500n,
      currency: "USD",
    });
  });

  it("trusts the raw body, never a caller-supplied payload", async () => {
    const ledger = await setupPaid();
    const raw = JSON.stringify(paidBody({ amount: 0.01 }));
    const result = await providerWith(ledger).confirm(
      { amount: 999999, status: "PAID" },
      { rawBody: raw, headers: signed(raw) }
    );
    expect(result).toEqual({ handled: true });
    expect(ledger.paid[0].amountMinor).toBe(1n);
  });

  it("rejects a tampered body even with a valid structure", async () => {
    const ledger = await setupPaid();
    const raw = JSON.stringify(paidBody());
    const tampered = JSON.stringify(paidBody({ amount: 0.01 }));
    await expect(
      providerWith(ledger).confirm({}, { rawBody: tampered, headers: signed(raw) })
    ).rejects.toThrow(PaymentSignatureError);
    expect(ledger.paid).toHaveLength(0);
  });

  it("rejects a forged event about an untraceable link", async () => {
    const ledger = stubLedger(); // no recorded intent: nothing to match
    const raw = JSON.stringify(paidBody());
    await expect(
      providerWith(ledger).confirm({}, { rawBody: raw, headers: signed(raw) })
    ).rejects.toThrow(/never created/);
    expect(ledger.paid).toHaveLength(0);
  });

  it("refuses a wrong amount instead of recording it", async () => {
    const ledger = await setupPaid();
    const raw = JSON.stringify(paidBody({ amount: "not money" }));
    await expect(
      providerWith(ledger).confirm({}, { rawBody: raw, headers: signed(raw) })
    ).rejects.toThrow(PaymentPayloadError);
    expect(ledger.paid).toHaveLength(0);
  });

  it("refuses a non-USD settlement for a USD integration", async () => {
    const ledger = await setupPaid();
    const raw = JSON.stringify(paidBody({ currency: "EUR", amount: 25.0 }));
    await expect(
      providerWith(ledger).confirm({}, { rawBody: raw, headers: signed(raw) })
    ).rejects.toThrow(/currency/);
    expect(ledger.paid).toHaveLength(0);
  });

  it("audits a recognised non-paid completion without changing state", async () => {
    const ledger = await setupPaid();
    const raw = JSON.stringify(paidBody({ status: "PENDING" }));
    const result = await providerWith(ledger).confirm({}, { rawBody: raw, headers: signed(raw) });
    expect(result).toEqual({ handled: true });
    expect(ledger.paid).toHaveLength(0);
    expect(ledger.events).toHaveLength(1);
  });

  it("refuses an event with no body or no JSON", async () => {
    const ledger = await setupPaid();
    await expect(providerWith(ledger).confirm({}, { rawBody: "   ", headers: {} })).rejects.toThrow(
      /no body/
    );
    await expect(
      providerWith(ledger).confirm({}, { rawBody: "not json", headers: signed("not json") })
    ).rejects.toThrow(/not a Linkwa message/);
  });

  it("gives replayed deliveries the same dedupe key", async () => {
    const ledger = await setupPaid();
    const provider = providerWith(ledger);
    const raw = JSON.stringify(paidBody());
    const headers = signed(raw);
    await provider.confirm({}, { rawBody: raw, headers });
    await provider.confirm({}, { rawBody: raw, headers });
    expect(ledger.paid).toHaveLength(2);
    expect(ledger.paid[0].eventId).toBe(ledger.paid[1].eventId);
  });
});

describe("Linkwa payouts (unwired helpers)", () => {
  const config = { apiKey: "sk_live_test", baseUrl: BASE };

  it("links a recipient by phone and keeps the returned user id", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        user: {
          external_user_id: "01kuser",
          first_name: "A",
          last_name: "B",
          phone_number: "263771234567",
        },
      })) as typeof fetch;
    const linked = await linkLinkwaUser({ ...config, fetchImpl }, {
      firstName: "A",
      lastName: "B",
      phoneNumber: "263771234567",
    });
    expect(linked.externalUserId).toBe("01kuser");
  });

  it("refuses to link without a name and number", async () => {
    await expect(
      linkLinkwaUser({ ...config }, { firstName: "", lastName: "B", phoneNumber: "263" })
    ).rejects.toThrow(/name and a phone number/);
  });

  it("names an explicit registration demand instead of failing it", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ requires_registration: true, required_fields: ["id_number"] })) as typeof fetch;
    await expect(
      registerLinkwaWallet({ ...config, fetchImpl }, {
        externalUserId: "01kuser",
        phoneNumber: "263770000000",
      })
    ).rejects.toThrow(/registration details/);
  });

  it("returns the wallet id when Linkwa links one", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ wallet: { external_wallet_id: "w_abc", provider: "smilecash" } })) as typeof fetch;
    const wallet = await registerLinkwaWallet({ ...config, fetchImpl }, {
      externalUserId: "01kuser",
      phoneNumber: "263771234567",
    });
    expect(wallet.externalWalletId).toBe("w_abc");
  });

  it("instructs an exact-minor-amount payout and returns the provider id", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return jsonResponse({ payout: { payout_id: "01JXYZ", amount: 23.75, currency: "USD" } });
    }) as typeof fetch;
    const result = await instructLinkwaPayout({ ...config, fetchImpl }, {
      externalUserId: "01kuser",
      externalWalletId: "w_abc",
      amountMinor: 2375n,
    });
    expect(result).toMatchObject({ payoutId: "01JXYZ", amountMinor: 2375n, currency: "USD" });
    expect(calls[0]).toMatchObject({ amount: 23.75, currency_code: "USD" });
  });

  it("refuses zero payouts and missing wallet linkage", async () => {
    await expect(
      instructLinkwaPayout({ ...config }, { externalUserId: "u", externalWalletId: "w", amountMinor: 0n })
    ).rejects.toThrow(/greater than zero/);
    await expect(
      instructLinkwaPayout({ ...config }, { externalUserId: "", externalWalletId: "w", amountMinor: 100n })
    ).rejects.toThrow(/linked user and wallet/);
  });

  it("reads balance and statement as exact minor units", async () => {
    const fetchImpl = (async (url: unknown) => {
      const text = String(url);
      if (text.includes("/balance")) {
        return jsonResponse({ balances: [{ currency: "USD", available_balance: 1.5, pending_balance: 0 }] });
      }
      return jsonResponse({
        data: [
          {
            id: "sb1",
            type: "debit",
            currency: "USD",
            description: "Third-party payout 01JXYZ instructed.",
            amount: 9.5,
            balance_after: 1.5,
            created_date: "2026-10-05T10:00:00+00:00",
            recipient: { type: "payout" },
          },
        ],
      });
    }) as typeof fetch;
    const balances = await fetchLinkwaBalance({ ...config, fetchImpl });
    expect(balances).toEqual([{ currency: "USD", availableMinor: 150n, pendingMinor: 0n }]);
    const statement = await fetchLinkwaStatement({ ...config, fetchImpl });
    expect(statement[0]).toMatchObject({
      type: "debit",
      amountMinor: 950n,
      balanceAfterMinor: 150n,
      recipientType: "payout",
    });
  });
});

 it("recognises an explicit wallet registration demand on HTTP 422 without exposing provider text", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ requires_registration: true, message: "private provider details" }), { status: 422 })) as typeof fetch;
  await expect(registerLinkwaWallet({ apiKey: "test-key", baseUrl: "https://linkwa.co.zw", fetchImpl }, { externalUserId: "user-id", phoneNumber: "+263771234567" })).rejects.toMatchObject({ reason: "wallet_registration_required" });
});

it("sends the documented digits-only international phone to both Linkwa recipient and wallet endpoints", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(bodies.length === 1 ? { user: { external_user_id: "linked-user" } } : { wallet: { external_wallet_id: "wallet", provider: "smilecash" } }), { status: 200 });
  }) as typeof fetch;
  const config = { apiKey: "test-key", baseUrl: "https://linkwa.co.zw", fetchImpl };
  await linkLinkwaUser(config, { firstName: "Test", lastName: "Seller", phoneNumber: "+263771234567" });
  await registerLinkwaWallet(config, { externalUserId: "linked-user", phoneNumber: "+263771234567" });
  expect(bodies.map(body => body.phone_number)).toEqual(["263771234567", "263771234567"]);
});
it("keeps only known validation field names from a provider refusal", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ message: "private identity", errors: { phone_number: ["private phone"], secret: ["private secret"] } }), { status: 422 })) as typeof fetch;
  await expect(registerLinkwaWallet({ apiKey: "test-key", baseUrl: "https://linkwa.co.zw", fetchImpl }, { externalUserId: "linked-user", phoneNumber: "+263771234567" })).rejects.toMatchObject({ httpStatus: 422, validationFields: ["phone_number"] });
});
