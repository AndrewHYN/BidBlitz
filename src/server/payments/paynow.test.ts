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
  PaymentIntentRecord,
  PaymentLedger,
  RecordEventInput,
  RecordIntentInput,
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
const OTHER_TX = "9c8b7a6d-5e4f-4a3b-9c2d-1f0e9d8c7b6a";
const POLL_URL = "https://www.paynow.co.zw/Interface/CheckPayment/?guid=abc";

type StubLedger = PaymentLedger & {
  paid: MarkPaidInput[];
  failed: MarkFailedInput[];
  refunded: MarkRefundedInput[];
  events: RecordEventInput[];
  intents: RecordIntentInput[];
  /** What readIntent() answers — `null` means no session was ever stored. */
  intent: PaymentIntentRecord | null;
  /** Transitions the database has already applied, to model a re-check. */
  applied: { paid: boolean; failed: boolean; refunded: boolean };
};

function stubLedger(): StubLedger {
  const paid: MarkPaidInput[] = [];
  const failed: MarkFailedInput[] = [];
  const refunded: MarkRefundedInput[] = [];
  const events: RecordEventInput[] = [];
  const intents: RecordIntentInput[] = [];
  const applied = { paid: false, failed: false, refunded: false };
  const ledger: StubLedger = {
    paid,
    failed,
    refunded,
    events,
    intents,
    intent: { transactionId: TX, provider: "paynow", pollUrl: POLL_URL, browserUrl: null, providerReference: null },
    applied,
    async markPaid(input) {
      // Faithful to mark_transaction_paid(): the answer says whether the row
      // was ALREADY paid before this call, then records the transition.
      const alreadyPaid = applied.paid;
      paid.push(input);
      applied.paid = true;
      return { alreadyPaid };
    },
    async markFailed(input) {
      const alreadyFailed = applied.failed;
      failed.push(input);
      applied.failed = true;
      return { alreadyFailed };
    },
    async markRefunded(input) {
      const alreadyRefunded = applied.refunded;
      refunded.push(input);
      applied.refunded = true;
      return { alreadyRefunded };
    },
    async recordEvent(input) {
      events.push(input);
    },
    async recordIntent(input) {
      intents.push(input);
      ledger.intent = {
        transactionId: input.transactionId,
        provider: input.provider,
        pollUrl: input.pollUrl,
        browserUrl: input.browserUrl ?? null,
        providerReference: input.providerReference ?? null,
      };
    },
    async readIntent(transactionId) {
      return ledger.intent?.transactionId === transactionId ? ledger.intent : null;
    },
    async findTransactionByProviderReference() {
      // Paynow matches by its own reference field, never by reverse lookup.
      return null;
    },
  };
  return ledger;
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

  it("stores the poll address before the buyer leaves for Paynow", async () => {
    const ledger = stubLedger();
    const replyFields: Array<[string, string]> = [
      ["Status", "Ok"],
      ["BrowserUrl", "https://www.paynow.co.zw/Payment/ConfirmPayment/9510"],
      ["PollUrl", "https://www.paynow.co.zw/Interface/CheckPayment/?guid=abc"],
      ["PaynowReference", "9510"],
    ];
    const reply = new URLSearchParams([
      ...replyFields,
      ["Hash", paynowHash(replyFields, INTEGRATION_KEY)],
    ]).toString();

    await providerWith(ledger, async () => new Response(reply, { status: 200 })).createIntent({
      transactionId: TX,
      amountMinor: 1000n,
      currency: "USD",
      idempotencyKey: `checkout:${TX}`,
    });

    expect(ledger.intents).toHaveLength(1);
    expect(ledger.intents[0]).toMatchObject({
      transactionId: TX,
      provider: "paynow",
      pollUrl: "https://www.paynow.co.zw/Interface/CheckPayment/?guid=abc",
      browserUrl: "https://www.paynow.co.zw/Payment/ConfirmPayment/9510",
      providerReference: "9510",
    });
    // ...and it is readable again, which is the whole point of storing it.
    expect(ledger.intent?.pollUrl).toContain("CheckPayment");
  });

  it("refuses to start a payment whose session cannot be stored", async () => {
    // A payment we could never reconcile must not be handed to the buyer as
    // if it were fine: the fallback path is part of the checkout contract.
    const ledger = stubLedger();
    ledger.recordIntent = async () => {
      throw new PaymentProviderError("PAYMENT_LEDGER_FAILED", "insert failed");
    };
    const replyFields: Array<[string, string]> = [
      ["Status", "Ok"],
      ["BrowserUrl", "https://www.paynow.co.zw/Payment/ConfirmPayment/9510"],
      ["PollUrl", "https://www.paynow.co.zw/Interface/CheckPayment/?guid=abc"],
    ];
    const reply = new URLSearchParams([
      ...replyFields,
      ["Hash", paynowHash(replyFields, INTEGRATION_KEY)],
    ]).toString();

    await expect(
      providerWith(ledger, async () => new Response(reply, { status: 200 })).createIntent({
        transactionId: TX,
        amountMinor: 1000n,
        currency: "USD",
        idempotencyKey: "k",
      })
    ).rejects.toBeInstanceOf(PaymentProviderError);
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

// ---------------------------------------------------------------------------
// reconcile() — the server-side fallback for the status update that never
// arrives (ADR-011: six initiations, zero POSTs to resulturl).
//
// Same signature rules as confirm(), same ledger, and no browser anywhere in
// the loop: the caller re-reads amount/currency/reference from Postgres and
// the reply still has to be Paynow's own signed message about that exact sale.
// ---------------------------------------------------------------------------

describe("PaynowPaymentProvider.reconcile", () => {
  const SALE = { transactionId: TX, amountMinor: 1000n, currency: "USD" };

  /** Paynow's CheckPayment endpoint answering with a signed status message. */
  function pollFetch(raw: string): typeof fetch {
    return async () => new Response(raw, { status: 200 });
  }

  function providerForReply(
    ledger: PaymentLedger,
    fields: Array<[string, string]>,
    key = INTEGRATION_KEY
  ) {
    return providerWith(ledger, pollFetch(signed(fields, key)));
  }

  it("confirms a genuine signed Paid status and applies it once", async () => {
    const ledger = stubLedger();
    const provider = providerForReply(
      ledger,
      statusFields({ status: "Paid", amount: "10.00" })
    );

    const result = await provider.reconcile(SALE);

    expect(result).toEqual({
      providerStatus: "Paid",
      outcome: "paid",
      applied: true,
    });
    expect(ledger.paid).toHaveLength(1);
    expect(ledger.paid[0]).toMatchObject({
      transactionId: TX,
      provider: "paynow",
      amountMinor: 1000n,
      currency: "USD",
      eventId: `paynow:${TX}:9510:paid`,
    });
    expect(ledger.failed).toHaveLength(0);
    // The audit payload says WHICH half of the contract delivered it.
    expect(ledger.paid[0].payload?.source).toBe("pollurl");
  });

  it("records a genuine signed Cancelled as FAILED, never as PAID", async () => {
    const ledger = stubLedger();
    const provider = providerForReply(
      ledger,
      statusFields({ status: "Cancelled" })
    );

    const result = await provider.reconcile(SALE);

    expect(result).toMatchObject({ outcome: "failed", applied: true });
    expect(ledger.paid).toHaveLength(0);
    expect(ledger.failed).toHaveLength(1);
    expect(ledger.failed[0].eventId).toBe(`paynow:${TX}:9510:cancelled`);
  });

  it("refuses a reply whose hash was made with another key", async () => {
    const ledger = stubLedger();
    const provider = providerForReply(
      ledger,
      statusFields({ status: "Paid", amount: "10.00" }),
      "00000000-0000-0000-0000-000000000000"
    );

    await expect(provider.reconcile(SALE)).rejects.toBeInstanceOf(
      PaymentSignatureError
    );
    expect(ledger.paid).toHaveLength(0);
    expect(ledger.events).toHaveLength(0);
  });

  it("refuses a reply whose value was tampered with after signing", async () => {
    const ledger = stubLedger();
    const authentic = signed(statusFields({ status: "Paid", amount: "10.00" }));
    const provider = providerWith(ledger, pollFetch(authentic.replace("amount=10.00", "amount=99.00")));

    await expect(provider.reconcile(SALE)).rejects.toBeInstanceOf(
      PaymentSignatureError
    );
    expect(ledger.paid).toHaveLength(0);
  });

  it("refuses a reply whose amount does not match the recorded sale", async () => {
    const ledger = stubLedger();
    const provider = providerForReply(
      ledger,
      statusFields({ status: "Paid", amount: "99.00" })
    );

    await expect(provider.reconcile(SALE)).rejects.toMatchObject({
      reason: "amount_mismatch",
    });
    expect(ledger.paid).toHaveLength(0);
    expect(ledger.events).toHaveLength(0);
  });

  it("refuses a genuine reply about a different transaction", async () => {
    const ledger = stubLedger();
    const provider = providerForReply(
      ledger,
      statusFields({ status: "Paid", amount: "10.00", reference: OTHER_TX })
    );

    await expect(provider.reconcile(SALE)).rejects.toMatchObject({
      reason: "reference_mismatch",
    });
    expect(ledger.paid).toHaveLength(0);
  });

  it("refuses a status outside the published vocabulary", async () => {
    const ledger = stubLedger();
    const provider = providerForReply(
      ledger,
      statusFields({ status: "Paid (guaranteed)" })
    );

    await expect(provider.reconcile(SALE)).rejects.toMatchObject({
      reason: "unrecognized_payload",
    });
    expect(ledger.paid).toHaveLength(0);
  });

  it("re-checks the same status without producing a second audit key", async () => {
    const ledger = stubLedger();
    const provider = providerForReply(
      ledger,
      statusFields({ status: "Paid", amount: "10.00" })
    );

    const first = await provider.reconcile(SALE);
    const second = await provider.reconcile(SALE);

    expect(first).toMatchObject({ applied: true });
    // Same provider message => same (provider, event_id) => the dedupe in
    // payment_events records it exactly once, and the row is already PAID so
    // the second answer writes nothing.
    expect(second).toMatchObject({ outcome: "paid", applied: false });
    expect(ledger.paid).toHaveLength(2);
    expect(ledger.paid[0].eventId).toBe(ledger.paid[1].eventId);
  });

  it("reports an already-paid transaction without re-applying anything", async () => {
    const ledger = stubLedger();
    ledger.applied.paid = true; // the webhook (or an earlier check) got there first
    const provider = providerForReply(
      ledger,
      statusFields({ status: "Paid", amount: "10.00" })
    );

    const result = await provider.reconcile(SALE);

    expect(result).toMatchObject({ outcome: "paid", applied: false });
    expect(ledger.paid).toHaveLength(1);
  });

  it("leaves an in-flight status exactly where it was", async () => {
    const ledger = stubLedger();
    const provider = providerForReply(
      ledger,
      statusFields({ status: "Created", amount: "10.00" })
    );

    const result = await provider.reconcile(SALE);

    expect(result).toEqual({
      providerStatus: "Created",
      outcome: "noted",
      applied: false,
    });
    // Audited, deduped, and — crucially — no transition of any kind.
    expect(ledger.events).toHaveLength(1);
    expect(ledger.paid).toHaveLength(0);
    expect(ledger.failed).toHaveLength(0);
    expect(ledger.refunded).toHaveLength(0);
  });

  it("reports a provider/network failure without touching the transaction", async () => {
    const ledger = stubLedger();
    const down: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const provider = providerWith(ledger, down);

    await expect(provider.reconcile(SALE)).rejects.toBeInstanceOf(
      PaymentProviderRequestError
    );
    expect(ledger.paid).toHaveLength(0);
    expect(ledger.failed).toHaveLength(0);
    expect(ledger.events).toHaveLength(0);

    const refused: typeof fetch = async () => new Response("nope", { status: 503 });
    await expect(
      providerWith(ledger, refused).reconcile(SALE)
    ).rejects.toBeInstanceOf(PaymentProviderRequestError);
    expect(ledger.paid).toHaveLength(0);
  });

  it("refuses to poll when no payment session was recorded", async () => {
    const ledger = stubLedger();
    ledger.intent = null;
    // Any network call here would be a bug: there is nothing to ask.
    const exploding: typeof fetch = async () => {
      throw new Error("the provider must not be contacted");
    };

    await expect(
      providerWith(ledger, exploding).reconcile(SALE)
    ).rejects.toMatchObject({ reason: "no_poll_url" });
  });

  it("refuses a stored status address that is not Paynow's", async () => {
    const ledger = stubLedger();
    ledger.intent = {
      transactionId: TX,
      provider: "paynow",
      pollUrl: "https://evil.example.com/CheckPayment/?guid=abc",
      browserUrl: null,
      providerReference: null,
    };
    const exploding: typeof fetch = async () => {
      throw new Error("the provider must not be contacted");
    };

    await expect(
      providerWith(ledger, exploding).reconcile(SALE)
    ).rejects.toMatchObject({ reason: "invalid_poll_url" });
  });

  it("refuses a sale recorded in a currency Paynow does not settle", async () => {
    const ledger = stubLedger();
    const exploding: typeof fetch = async () => {
      throw new Error("the provider must not be contacted");
    };

    await expect(
      providerWith(ledger, exploding).reconcile({
        transactionId: TX,
        amountMinor: 1000n,
        currency: "EUR",
      })
    ).rejects.toMatchObject({ reason: "currency_mismatch" });
  });

  it("polls the exact address Paynow handed us at initiation", async () => {
    const ledger = stubLedger();
    const asked: string[] = [];
    const provider = providerWith(ledger, async (input) => {
      asked.push(String(input));
      return new Response(signed(statusFields({ status: "Created" })), {
        status: 200,
      });
    });

    await provider.reconcile(SALE);

    expect(asked).toEqual([POLL_URL]);
  });
});
