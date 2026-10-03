import { describe, expect, it } from "vitest";
import { readLinkwaEnvironment, readPaynowEnvironment } from "./config";

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
      missing: ["PAYNOW_INTEGRATION_KEY"],
      config: null,
    });

    expect(
      readPaynowEnvironment({ PAYNOW_INTEGRATION_KEY: "only-a-key" })
    ).toEqual({
      state: "incomplete",
      missing: ["PAYNOW_INTEGRATION_ID"],
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
