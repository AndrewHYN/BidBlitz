import { describe, expect, it } from "vitest";
import {
  PAYNOW_INITIATE_URL,
  PaynowPaymentProvider,
  minorToPaynowAmount,
  parsePaynowForm,
  paynowAmountToMinor,
  paynowConcatenate,
  paynowEventId,
  paynowField,
  paynowHash,
  paynowHashMatches,
  paynowOutcome,
  verifyPaynowHash,
} from "./paynow";
import {
  PaymentPayloadError,
  PaymentProviderError,
  PaymentProviderRequestError,
  PaymentSignatureError,
  PaymentUnsupportedOperationError,
} from "./provider";
import type {
  MarkFailedInput,
  MarkPaidInput,
  MarkRefundedInput,
  PaymentLedger,
  RecordEventInput,
} from "./ledger";

/**
 * Paynow contract tests.
 *
 * The two hash tests at the top are the important ones: they assert our
 * implementation against the worked examples PUBLISHED by Paynow
 * (developers.paynow.co.zw -> Generating Hash / Validating Hash), using
 * Paynow's own published example integration key. If Paynow's documented
 * procedure ever changes, these fail first.
 *
 * Everything else exercises the rules the mandate requires of a webhook —
 * signature before state, amount, currency, unknown transaction, replay,
 * duplicate, failed and refunded paths — against an injected ledger so no
 * database and no network are involved.
 */

// Paynow's own published example integration key (developers.paynow.co.zw).
const INTEGRATION_KEY = "3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977";
const TX = "3f1d2a4c-9b8e-4f6a-8c2d-1e5b7a9c0f34";

type StubLedger = PaymentLedger & {
  paid: MarkPaidInput[];
  failed: MarkFailedInput[];
  refunded: MarkRefundedInput[];
  events: RecordEventInput[];
};

function stubLedger(): StubLedger {
  const paid: MarkPaidInput[] = [];
  const failed: MarkFailedInput[] = [];
  const refunded: MarkRefundedInput[] = [];
  const events: RecordEventInput[] = [];
  return {
    paid,
    failed,
    refunded,
    events,
    async markPaid(input) {
      paid.push(input);
      return { alreadyPaid: false };
    },
    async markFailed(input) {
      failed.push(input);
      return { alreadyFailed: false };
    },
    async markRefunded(input) {
      refunded.push(input);
      return { alreadyRefunded: false };
    },
    async recordEvent(input) {
      events.push(input);
    },
  };
}

/** Build a message exactly as Paynow would receive it: fields + hash. */
function signed(
  fields: Array<[string, string]>,
  key = INTEGRATION_KEY
): string {
  return new URLSearchParams([
    ...fields,
    ["hash", paynowHash(fields, key)],
  ]).toString();
}

function providerWith(ledger: PaymentLedger, fetchImpl?: typeof fetch) {
  return new PaynowPaymentProvider({
    integrationId: "1201",
    integrationKey: INTEGRATION_KEY,
    resultUrl: "https://bid-blitz-ten.vercel.app/api/payments/webhook",
    returnUrl: "https://bid-blitz-ten.vercel.app/dashboard/transactions",
    ledger,
    fetchImpl,
  });
}

function statusFields(overrides: Record<string, string> = {}): Array<[string, string]> {
  const base: Record<string, string> = {
    reference: TX,
    amount: "10.00",
    paynowreference: "9510",
    status: "Paid",
    pollurl: "https://www.paynow.co.zw/Interface/CheckPayment/?guid=abc",
    ...overrides,
  };
  return Object.entries(base);
}

function contextFor(fields: Array<[string, string]>, key = INTEGRATION_KEY) {
  return {
    rawBody: signed(fields, key),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  };
}

// ---------------------------------------------------------------------------
// The published vectors
// ---------------------------------------------------------------------------

describe("Paynow hash — official worked examples", () => {
  it("reproduces Paynow's published OUTBOUND example hash", () => {
    // Verbatim from "Generating a hash for an outbound message", including
    // the leading space inside `returnurl= http://...`.
    const fields: Array<[string, string]> = [
      ["id", "1201"],
      ["reference", "TEST REF"],
      ["amount", "99.99"],
      ["additionalinfo", "A test ticket transaction"],
      ["returnurl", " http://www.google.com/search?q=returnurl"],
      ["resulturl", "http://www.google.com/search?q=resulturl"],
      ["status", "Message"],
    ];

    expect(paynowConcatenate(fields, INTEGRATION_KEY)).toBe(
      "1201TEST REF99.99A test ticket transaction" +
        "http://www.google.com/search?q=returnurl" +
        "http://www.google.com/search?q=resulturl" +
        "Message" +
        INTEGRATION_KEY
    );
    expect(paynowHash(fields, INTEGRATION_KEY)).toBe(
      "2A033FC38798D913D42ECB786B9B19645ADEDBDE788862032F1BD82CF3B92DEF" +
        "84F316385D5B40DBB35F1A4FD7D5BFE73835174136463CDD48C9366B0749C689"
    );
  });

  it("reproduces Paynow's published INBOUND example hash", () => {
    const raw =
      "status=Ok" +
      "&browserurl=https%3a%2f%2fstaging.paynow.co.zw%2fPayment%2fConfirmPayment%2f9510" +
      "&pollurl=https%3a%2f%2fstaging.paynow.co.zw%2fInterface%2fCheckPayment%2f%3fguid%3dc7ed41da-0159-46da-b428-69549f770413" +
      "&paynowreference=9510" +
      "&hash=750DD0B0DF374678707BB5AF915AF81C228B9058AD57BB7120569EC68BBB9C2EFC1B26C6375D2BC562AC909B3CD6B2AF1D42E1A5E479FFAC8F4FB3FDCE71DF4D";

    const fields = parsePaynowForm(raw);
    expect(paynowField(fields, "status")).toBe("Ok");
    expect(paynowField(fields, "browserurl")).toBe(
      "https://staging.paynow.co.zw/Payment/ConfirmPayment/9510"
    );
    expect(() => verifyPaynowHash(fields, INTEGRATION_KEY)).not.toThrow();
  });
});

describe("Paynow hash — rejection", () => {
  it("rejects a message whose hash was made with another key", () => {
    const fields = statusFields();
    const context = contextFor(fields, "00000000-0000-0000-0000-000000000000");
    const provider = providerWith(stubLedger());

    return expect(provider.confirm({}, context)).rejects.toBeInstanceOf(
      PaymentSignatureError
    );
  });

  it("rejects a message with a tampered value", () => {
    const authentic = signed(statusFields({ amount: "10.00" }));
    const tampered = authentic.replace("amount=10.00", "amount=1.00");
    const provider = providerWith(stubLedger());

    return expect(
      provider.confirm({}, { rawBody: tampered, headers: {} })
    ).rejects.toBeInstanceOf(PaymentSignatureError);
  });

  it("rejects a message carrying no hash at all", () => {
    const provider = providerWith(stubLedger());
    return expect(
      provider.confirm({}, { rawBody: "status=Paid&reference=abc", headers: {} })
    ).rejects.toBeInstanceOf(PaymentSignatureError);
  });

  it("does not treat two different digests of equal length as equal", () => {
    const a = paynowHash([["a", "b"]], "key-a");
    const b = paynowHash([["a", "b"]], "key-b");
    expect(a).toHaveLength(b.length);
    expect(paynowHashMatches(a, b)).toBe(false);
    expect(paynowHashMatches(a, a)).toBe(true);
    expect(paynowHashMatches("", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Message and value handling
// ---------------------------------------------------------------------------

describe("Paynow message parsing", () => {
  it("preserves field order and URL-decodes values", () => {
    const fields = parsePaynowForm(
      "status=Awaiting+Delivery&reference=abc&amount=1.00"
    );
    expect(fields).toEqual([
      ["status", "Awaiting Delivery"],
      ["reference", "abc"],
      ["amount", "1.00"],
    ]);
  });

  it("reads fields case-insensitively (the docs publish both casings)", () => {
    const fields = parsePaynowForm("Status=Ok&Hash=deadbeef");
    expect(paynowField(fields, "status")).toBe("Ok");
    expect(paynowField(fields, "hash")).toBe("deadbeef");
    expect(paynowField(fields, "missing")).toBeNull();
  });

  it("returns nothing for a body that is not a form message", () => {
    expect(parsePaynowForm("")).toEqual([]);
    expect(parsePaynowForm("   ")).toEqual([]);
    expect(parsePaynowForm("not a form message")).toEqual([]);
  });
});

describe("Paynow amounts", () => {
  it("round-trips minor units to two decimal places", () => {
    expect(paynowAmountToMinor("99.99")).toBe(9999n);
    expect(paynowAmountToMinor("10.00")).toBe(1000n);
    expect(paynowAmountToMinor("1")).toBe(100n);
    expect(minorToPaynowAmount(9999n)).toBe("99.99");
    expect(minorToPaynowAmount(1000n)).toBe("10.00");
    expect(minorToPaynowAmount(5n)).toBe("0.05");
  });

  it("refuses amounts that are not plain two-decimal money", () => {
    for (const bad of ["abc", "-1.00", "1.005", "$5.00", "1,000.00", "", "  "]) {
      expect(() => paynowAmountToMinor(bad)).toThrow(PaymentPayloadError);
    }
  });
});

describe("Paynow status vocabulary", () => {
  it("maps every published status to the right outcome", () => {
    expect(paynowOutcome("Paid")).toBe("paid");
    expect(paynowOutcome("Awaiting Delivery")).toBe("paid");
    expect(paynowOutcome("Delivered")).toBe("paid");
    expect(paynowOutcome("Cancelled")).toBe("failed");
    expect(paynowOutcome("Refunded")).toBe("refunded");
    expect(paynowOutcome("Created")).toBe("noted");
    expect(paynowOutcome("Sent")).toBe("noted");
    expect(paynowOutcome("Disputed")).toBe("noted");
  });

  it("refuses a status it has never heard of", () => {
    expect(paynowOutcome("Paid (guaranteed)")).toBeNull();
    expect(paynowOutcome("")).toBeNull();
    expect(paynowOutcome(null)).toBeNull();
  });

  it("gives one stable dedupe key per delivery, and a new one per status", () => {
    const first = paynowEventId(TX, "9510", "Paid");
    expect(paynowEventId(TX, "9510", "Paid")).toBe(first);
    // Paynow normalises a status change into a new event, which must NOT
    // collide with the original in (provider, event_id).
    expect(paynowEventId(TX, "9510", "Awaiting Delivery")).not.toBe(first);
    expect(paynowEventId(TX, null, "Paid")).toContain(":-:paid");
  });
});

// ---------------------------------------------------------------------------
// confirm()
// ---------------------------------------------------------------------------

describe("PaynowPaymentProvider.confirm", () => {
  it("marks PAID with the exact amount, currency and dedupe key", async () => {
    const ledger = stubLedger();
    const provider = providerWith(ledger);

    const result = await provider.confirm(
      { ignored: "by design" },
      contextFor(statusFields({ status: "Paid", amount: "10.00" }))
    );

    expect(result).toEqual({ handled: true });
    expect(ledger.paid).toHaveLength(1);
    expect(ledger.paid[0]).toMatchObject({
      transactionId: TX,
      provider: "paynow",
      providerReference: "9510",
      amountMinor: 1000n,
      currency: "USD",
      eventId: `paynow:${TX}:9510:paid`,
    });
    expect(ledger.failed).toHaveLength(0);
  });

  it("treats Awaiting Delivery and Delivered as paid too", async () => {
    for (const status of ["Awaiting Delivery", "Delivered"]) {
      const ledger = stubLedger();
      await providerWith(ledger).confirm({}, contextFor(statusFields({ status })));
      expect(ledger.paid).toHaveLength(1);
    }
  });

  it("trusts the raw body, never the parsed payload handed to it", async () => {
    const ledger = stubLedger();
    // A caller that passed a doctored parsed body must not be able to steer
    // the outcome: the signature covers only the raw bytes.
    const lyingPayload = { status: "Paid", amount: "10.00", reference: TX };

    await providerWith(ledger).confirm(
      lyingPayload,
      contextFor(statusFields({ status: "Cancelled" }))
    );

    expect(ledger.paid).toHaveLength(0);
    expect(ledger.failed).toHaveLength(1);
  });

  it("gives a duplicate delivery the same dedupe key", async () => {
    const ledger = stubLedger();
    const provider = providerWith(ledger);
    const context = contextFor(statusFields({ status: "Paid" }));

    await provider.confirm({}, context);
    await provider.confirm({}, context);

    expect(ledger.paid).toHaveLength(2);
    expect(ledger.paid[1].eventId).toBe(ledger.paid[0].eventId);
  });

  it("rejects a wrong amount before it can be recorded", async () => {
    const ledger = stubLedger();
    await expect(
      providerWith(ledger).confirm(
        {},
        contextFor(statusFields({ amount: "10.005" }))
      )
    ).rejects.toMatchObject({ reason: "amount_mismatch" });
    expect(ledger.paid).toHaveLength(0);
  });

  it("rejects an event about a transaction id that is not ours", async () => {
    const ledger = stubLedger();
    await expect(
      providerWith(ledger).confirm(
        {},
        contextFor(statusFields({ reference: "invoice-1" }))
      )
    ).rejects.toMatchObject({ reason: "unknown_transaction" });
    expect(ledger.paid).toHaveLength(0);
    expect(ledger.events).toHaveLength(0);
  });

  it("leaves 'well formed but unknown' to the database, which owns the row list", async () => {
    const ledger = stubLedger();
    // A provider cannot know which transactions exist — and must not guess.
    // The id goes to mark_transaction_paid(), which raises
    // `transaction_not_found` (proven by the engine harness) and surfaces
    // here as the same `unknown_transaction` rejection.
    const unknown = "00000000-0000-0000-0000-000000000000";
    await providerWith(ledger).confirm(
      {},
      contextFor(statusFields({ reference: unknown }))
    );

    expect(ledger.paid).toHaveLength(1);
    expect(ledger.paid[0].transactionId).toBe(unknown);
  });

  it("records a cancellation as FAILED, never as PAID", async () => {
    const ledger = stubLedger();
    await providerWith(ledger).confirm(
      {},
      contextFor(statusFields({ status: "Cancelled" }))
    );
    expect(ledger.paid).toHaveLength(0);
    expect(ledger.failed).toHaveLength(1);
    expect(ledger.failed[0]).toMatchObject({
      transactionId: TX,
      provider: "paynow",
      eventId: `paynow:${TX}:9510:cancelled`,
    });
  });

  it("records a refund as REFUNDED", async () => {
    const ledger = stubLedger();
    await providerWith(ledger).confirm(
      {},
      contextFor(statusFields({ status: "Refunded" }))
    );
    expect(ledger.refunded).toHaveLength(1);
    expect(ledger.paid).toHaveLength(0);
    expect(ledger.failed).toHaveLength(0);
  });

  it("audits in-flight and disputed statuses without changing state", async () => {
    for (const status of ["Created", "Sent", "Disputed"]) {
      const ledger = stubLedger();
      const result = await providerWith(ledger).confirm(
        {},
        contextFor(statusFields({ status }))
      );
      expect(result).toEqual({ handled: true });
      expect(ledger.paid).toHaveLength(0);
      expect(ledger.failed).toHaveLength(0);
      expect(ledger.refunded).toHaveLength(0);
      expect(ledger.events).toHaveLength(1);
      expect(ledger.events[0].eventId).toBe(
        `paynow:${TX}:9510:${status.toLowerCase()}`
      );
    }
  });

  it("does not handle a status outside the published vocabulary", async () => {
    const ledger = stubLedger();
    const result = await providerWith(ledger).confirm(
      {},
      contextFor(statusFields({ status: "Something New" }))
    );
    expect(result).toEqual({ handled: false });
    expect(ledger.paid).toHaveLength(0);
    expect(ledger.events).toHaveLength(0);
  });

  it("refuses an event with no body", async () => {
    const ledger = stubLedger();
    const provider = providerWith(ledger);
    await expect(provider.confirm({})).rejects.toBeInstanceOf(PaymentPayloadError);
    await expect(
      provider.confirm({}, { rawBody: "", headers: {} })
    ).rejects.toBeInstanceOf(PaymentPayloadError);
    expect(ledger.paid).toHaveLength(0);
  });

  it("refuses a body that is not a Paynow message even when it parses", async () => {
    const ledger = stubLedger();
    await expect(
      providerWith(ledger).confirm(
        {},
        { rawBody: "this is not a Paynow message", headers: {} }
      )
    ).rejects.toBeInstanceOf(PaymentPayloadError);
    expect(ledger.paid).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createIntent() / cancel()
// ---------------------------------------------------------------------------

describe("PaynowPaymentProvider.createIntent", () => {
  it("posts a correctly signed initiate request and returns the payment page", async () => {
    const sent: Array<{ url: string; body: string }> = [];

    const replyFields: Array<[string, string]> = [
      ["Status", "Ok"],
      ["BrowserUrl", "https://www.paynow.co.zw/Payment/ConfirmPayment/9510"],
      ["PollUrl", "https://www.paynow.co.zw/Interface/CheckPayment/?guid=abc"],
    ];
    const reply = new URLSearchParams([
      ...replyFields,
      ["Hash", paynowHash(replyFields, INTEGRATION_KEY)],
    ]).toString();

    const fetchImpl: typeof fetch = async (input, init) => {
      sent.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(reply, { status: 200 });
    };

    const intent = await providerWith(stubLedger(), fetchImpl).createIntent({
      transactionId: TX,
      amountMinor: 1000n,
      currency: "USD",
      idempotencyKey: `checkout:${TX}`,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(PAYNOW_INITIATE_URL);

    const fields = Array.from(new URLSearchParams(sent[0].body));
    expect(paynowField(fields, "id")).toBe("1201");
    expect(paynowField(fields, "reference")).toBe(TX);
    expect(paynowField(fields, "amount")).toBe("10.00");
    expect(paynowField(fields, "status")).toBe("Message");
    expect(paynowField(fields, "resulturl")).toBe(
      "https://bid-blitz-ten.vercel.app/api/payments/webhook"
    );
    expect(paynowField(fields, "returnurl")).toBe(
      "https://bid-blitz-ten.vercel.app/dashboard/transactions"
    );

    // The secret never travels: only its SHA-512-derived hash does.
    expect(sent[0].body).not.toContain(INTEGRATION_KEY);

    // And the hash we sent is the one Paynow will recompute.
    const hash = paynowField(fields, "hash");
    expect(hash).toBeTruthy();
    if (!hash) throw new Error("outbound message carried no hash");
    expect(paynowHashMatches(paynowHash(fields, INTEGRATION_KEY), hash)).toBe(true);

    expect(intent).toMatchObject({
      transactionId: TX,
      amountMinor: 1000n,
      currency: "USD",
      status: "requires_action",
      redirectUrl: "https://www.paynow.co.zw/Payment/ConfirmPayment/9510",
    });
    expect(intent.id).toContain("CheckPayment");
  });

  it("refuses to start a payment whose reply does not verify", async () => {
    const replyFields: Array<[string, string]> = [
      ["Status", "Ok"],
      ["BrowserUrl", "https://www.paynow.co.zw/Payment/ConfirmPayment/9510"],
    ];
    const reply = new URLSearchParams([
      ...replyFields,
      ["Hash", paynowHash(replyFields, "a-different-key")],
    ]).toString();

    const fetchImpl: typeof fetch = async () => new Response(reply, { status: 200 });

    await expect(
      providerWith(stubLedger(), fetchImpl).createIntent({
        transactionId: TX,
        amountMinor: 1000n,
        currency: "USD",
        idempotencyKey: "k",
      })
    ).rejects.toBeInstanceOf(PaymentSignatureError);
  });

  it("surfaces Paynow's refusal instead of inventing an intent", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("Status=Error&Error=Invalid+amount+field", { status: 200 });

    await expect(
      providerWith(stubLedger(), fetchImpl).createIntent({
        transactionId: TX,
        amountMinor: 1000n,
        currency: "USD",
        idempotencyKey: "k",
      })
    ).rejects.toThrow(/Invalid amount field/);
  });

  it("reports a transport failure as a provider request failure", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };

    await expect(
      providerWith(stubLedger(), fetchImpl).createIntent({
        transactionId: TX,
        amountMinor: 1000n,
        currency: "USD",
        idempotencyKey: "k",
      })
    ).rejects.toBeInstanceOf(PaymentProviderRequestError);

    const failing: typeof fetch = async () => new Response("nope", { status: 503 });
    await expect(
      providerWith(stubLedger(), failing).createIntent({
        transactionId: TX,
        amountMinor: 1000n,
        currency: "USD",
        idempotencyKey: "k",
      })
    ).rejects.toBeInstanceOf(PaymentProviderRequestError);
  });

  it("refuses a currency Paynow cannot settle", async () => {
    await expect(
      providerWith(stubLedger()).createIntent({
        transactionId: TX,
        amountMinor: 1000n,
        currency: "EUR",
        idempotencyKey: "k",
      })
    ).rejects.toMatchObject({ code: "PAYMENT_UNSUPPORTED_CURRENCY" });
  });

  it("refuses a reference that is not one of our transactions", async () => {
    await expect(
      providerWith(stubLedger()).createIntent({
        transactionId: "invoice-1",
        amountMinor: 1000n,
        currency: "USD",
        idempotencyKey: "k",
      })
    ).rejects.toMatchObject({ reason: "unknown_transaction" });
  });

  it("fails loudly when constructed with a partial configuration", () => {
    expect(
      () =>
        new PaynowPaymentProvider({
          integrationId: "",
          integrationKey: INTEGRATION_KEY,
          resultUrl: "https://example.test/webhook",
          returnUrl: "https://example.test/return",
          ledger: stubLedger(),
        })
    ).toThrow(PaymentProviderError);
  });
});

describe("PaynowPaymentProvider.cancel", () => {
  it("refuses instead of pretending a payment was cancelled", async () => {
    await expect(providerWith(stubLedger()).cancel(TX)).rejects.toBeInstanceOf(
      PaymentUnsupportedOperationError
    );
  });
});

describe("PaynowPaymentProvider.capabilities", () => {
  it("describes itself truthfully", () => {
    const capabilities = providerWith(stubLedger()).capabilities;
    expect(capabilities).toMatchObject({
      id: "paynow",
      displayName: "Paynow",
      configured: true,
      currencies: ["USD"],
      // No documented server-initiated cancellation endpoint exists, so the
      // UI must never offer one.
      supportsCancellation: false,
    });
  });
});
