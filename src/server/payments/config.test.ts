import { describe, expect, it } from "vitest";
import {
  readCheckoutProviderPreference,
  readLinkwaEnvironment,
  readPaynowEnvironment,
  webhookProviderKind,
} from "./config";

/**
 * Credential reading only — no provider is constructed here.
 *
 * The rule these tests protect: half a configuration is NOT a configuration.
 * An integration id without its key must leave BidBlitz on the honest Noop
 * provider and say why, instead of building a provider that fails later, in
 * production, at the moment somebody tries to pay.
 */
describe("readPaynowEnvironment", () => {
  it("reports nothing configured when neither variable is present", () => {
    expect(readPaynowEnvironment({})).toEqual({
      state: "unset",
      missing: [],
      config: null,
    });
  });

  it("reports a complete configuration", () => {
    const env = {
      PAYNOW_INTEGRATION_ID: "1201",
      PAYNOW_INTEGRATION_KEY: "a-real-looking-key",
      PAYNOW_INTEGRATION_CURRENCY: "USD",
    };
    expect(readPaynowEnvironment(env)).toEqual({
      state: "ready",
      missing: [],
      config: {
        integrationId: "1201",
        integrationKey: "a-real-looking-key",
      },
    });
  });

  it("trims surrounding whitespace out of credentials", () => {
    const result = readPaynowEnvironment({
      PAYNOW_INTEGRATION_ID: "  1201\t",
      PAYNOW_INTEGRATION_KEY: " key \n",
    });
    expect(result.state).toBe("ready");
    expect(result.config).toEqual({
      integrationId: "1201",
      integrationKey: "key",
    });
  });

  it("names exactly which half is missing", () => {
    expect(
      readPaynowEnvironment({ PAYNOW_INTEGRATION_ID: "1201" })
    ).toEqual({
      state: "incomplete",
      missing: ["PAYNOW_INTEGRATION_KEY", "PAYNOW_INTEGRATION_CURRENCY"],
      config: null,
    });

    expect(
      readPaynowEnvironment({ PAYNOW_INTEGRATION_KEY: "only-a-key" })
    ).toEqual({
      state: "incomplete",
      missing: ["PAYNOW_INTEGRATION_ID", "PAYNOW_INTEGRATION_CURRENCY"],
      config: null,
    });
  });

  it("treats the placeholders in .env.example as unset, not as credentials", () => {
    for (const value of [
      "REPLACE_ME",
      "YOUR_INTEGRATION_KEY",
      "CHANGE_ME",
      "<paste here>",
      "",
      "   ",
    ]) {
      expect(
        readPaynowEnvironment({
          PAYNOW_INTEGRATION_ID: "1201",
          PAYNOW_INTEGRATION_KEY: value,
        }).state
      ).toBe("incomplete");
    }

    expect(
      readPaynowEnvironment({
        PAYNOW_INTEGRATION_ID: "REPLACE_ME",
        PAYNOW_INTEGRATION_KEY: "REPLACE_ME",
      }).state
    ).toBe("unset");
  });
});

describe("Paynow USD currency attestation", () => {
  it("refuses Paynow credentials without verified integration currency", () => {
    expect(readPaynowEnvironment({
      PAYNOW_INTEGRATION_ID: "1201",
      PAYNOW_INTEGRATION_KEY: "test-key",
    })).toMatchObject({
      state: "incomplete",
      missing: ["PAYNOW_INTEGRATION_CURRENCY"],
    });
  });

  it("refuses ZWG integration credentials for USD-denominated auctions", () => {
    expect(readPaynowEnvironment({
      PAYNOW_INTEGRATION_ID: "1201",
      PAYNOW_INTEGRATION_KEY: "test-key",
      PAYNOW_INTEGRATION_CURRENCY: "ZWG",
    })).toMatchObject({
      state: "incomplete",
      missing: ["PAYNOW_INTEGRATION_CURRENCY"],
    });
  });
});

describe("readLinkwaEnvironment", () => {
  it("reports nothing configured when no Linkwa variable is present", () => {
    expect(readLinkwaEnvironment({})).toEqual({
      state: "unset",
      missing: [],
      config: null,
    });
  });

  it("reports a complete configuration", () => {
    expect(
      readLinkwaEnvironment({
        LINKWA_API_KEY: "sk_live_abc",
        LINKWA_BASE_URL: "https://sandbox.linkwa.example",
        LINKWA_WEBHOOK_SECRET: "whsec-abc",
      })
    ).toEqual({
      state: "ready",
      missing: [],
      config: {
        apiKey: "sk_live_abc",
        baseUrl: "https://sandbox.linkwa.example",
        webhookSecret: "whsec-abc",
      },
    });
  });

  it("names exactly which pieces are missing", () => {
    expect(readLinkwaEnvironment({ LINKWA_API_KEY: "sk_live_abc" })).toEqual({
      state: "incomplete",
      missing: ["LINKWA_BASE_URL", "LINKWA_WEBHOOK_SECRET"],
      config: null,
    });
  });

  it("treats placeholders as unset, not as credentials", () => {
    expect(
      readLinkwaEnvironment({
        LINKWA_API_KEY: "REPLACE_ME",
        LINKWA_BASE_URL: "REPLACE_ME",
        LINKWA_WEBHOOK_SECRET: "REPLACE_ME",
      }).state
    ).toBe("unset");
  });
});

describe("checkout provider selection", () => {
  it("preserves the legacy default unless deliberately configured", () => {
    expect(readCheckoutProviderPreference({})).toBe("auto");
    expect(readCheckoutProviderPreference({ PAYMENT_PROVIDER: " auto " })).toBe("auto");
  });

  it("selects Paynow or Linkwa by an explicit flag, never by key priority", () => {
    expect(readCheckoutProviderPreference({ PAYMENT_PROVIDER: "PayNow" })).toBe("paynow");
    expect(readCheckoutProviderPreference({ PAYMENT_PROVIDER: "LINKWA" })).toBe("linkwa");
  });

  it("fails closed on an unknown value", () => {
    expect(readCheckoutProviderPreference({ PAYMENT_PROVIDER: "any" })).toBe("invalid");
    expect(readCheckoutProviderPreference({ PAYMENT_PROVIDER: "pay-now" })).toBe("invalid");
  });
});

describe("historical webhook routing hints", () => {
  it("routes Linkwa JSON and Paynow form-encoded bodies separately", () => {
    expect(webhookProviderKind('{"event":"payment.completed"}')).toBe("linkwa");
    expect(webhookProviderKind("reference=abc&hash=ABCDEF")).toBe("paynow");
  });

  it("does not infer provider on unsupported bodies", () => {
    expect(webhookProviderKind("")).toBeNull();
    expect(webhookProviderKind("not-a-webhook")).toBeNull();
  });
});
