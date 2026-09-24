import { afterEach, describe, expect, it } from "vitest";
import {
  NoopPaymentProvider,
  PaymentProviderNotConfiguredError,
  getPaymentProvider,
  isPaymentConfigured,
  setPaymentProvider,
  type CreateIntentInput,
  type PaymentIntent,
  type PaymentProvider,
} from "./provider";

const noop = new NoopPaymentProvider();

const fake: PaymentProvider = {
  capabilities: {
    id: "fake",
    displayName: "Fake provider",
    configured: true,
    supportsautomaticCapture: false,
    currencies: ["USD"],
  },
  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    return {
      id: "pi_fake",
      transactionId: input.transactionId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: "requires_action",
    };
  },
  async confirm(): Promise<{ handled: boolean }> {
    return { handled: true };
  },
  async cancel(): Promise<void> {
    /* nothing to cancel in the fake */
  },
};

afterEach(() => {
  setPaymentProvider(new NoopPaymentProvider());
});

describe("NoopPaymentProvider", () => {
  it("reports itself as not configured", () => {
    expect(noop.capabilities.configured).toBe(false);
    expect(noop.capabilities.id).toBe("none");
    expect(noop.capabilities.currencies).toContain("USD");
  });

  it("rejects createIntent with PAYMENT_PROVIDER_NOT_CONFIGURED", async () => {
    await expect(noop.createIntent()).rejects.toBeInstanceOf(
      PaymentProviderNotConfiguredError
    );
    await expect(noop.createIntent()).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
    });
  });

  it("confirms nothing", async () => {
    await expect(noop.confirm()).resolves.toEqual({ handled: false });
  });

  it("cancels nothing without throwing", async () => {
    await expect(noop.cancel()).resolves.toBeUndefined();
  });
});

describe("payment provider registry", () => {
  it("defaults to the unconfigured Noop provider", () => {
    setPaymentProvider(new NoopPaymentProvider());
    expect(isPaymentConfigured()).toBe(false);
    expect(getPaymentProvider()).toBeInstanceOf(NoopPaymentProvider);
  });

  it("reports configured once a provider is registered", () => {
    expect(isPaymentConfigured()).toBe(false);

    setPaymentProvider(fake);

    expect(isPaymentConfigured()).toBe(true);
    expect(getPaymentProvider()).toBe(fake);
  });

  it("delegates createIntent to the registered provider", async () => {
    setPaymentProvider(fake);

    const intent = await getPaymentProvider().createIntent({
      transactionId: "tx-1",
      amountMinor: 2500n,
      currency: "USD",
      idempotencyKey: "key-1",
    });

    expect(intent).toMatchObject({
      id: "pi_fake",
      transactionId: "tx-1",
      amountMinor: 2500n,
      currency: "USD",
      status: "requires_action",
    });
  });
});
