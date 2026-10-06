import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Boot-time provider selection — the gate every invariant in the payment layer
 * depends on.
 *
 * `config.test.ts` proves the two credential *readers*; nothing here existed
 * before, so `ensurePaymentProvider()` (Linkwa beats Paynow, half-set Linkwa
 * fails closed instead of falling through, and no provider becomes active
 * without SUPABASE_SECRET_KEY) was enforced by code nobody executed. These
 * tests run the real boot path.
 *
 * The environment is captured at import time (`admin.ts` reads
 * NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY in its module body), so each
 * case resets the module registry and re-imports instead of mutating a shared
 * instance. Nothing here reaches the network: boot only *selects* a provider.
 */

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "PAYNOW_INTEGRATION_ID",
  "PAYNOW_INTEGRATION_KEY",
  "LINKWA_API_KEY",
  "LINKWA_BASE_URL",
  "LINKWA_WEBHOOK_SECRET",
];

const saved = new Map<string, string | undefined>();

function setEnv(values: Record<string, string | undefined>) {
  for (const key of KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

type Booted = typeof import("./config");
type Registry = typeof import("./provider");

async function boot(): Promise<{ config: Booted; registry: Registry }> {
  vi.resetModules();
  const config = await import("./config");
  const registry = await import("./provider");
  // `ensurePaymentProvider()` decides lazily, on first use: the registry still
  // holds Noop until something asks. Every case below reads the decision, so
  // ask here — otherwise a "not configured" assertion would pass for the wrong
  // reason (nobody had booted yet).
  config.isPaymentProviderConfigured();
  return { config, registry };
}

beforeAll(async () => {
  // The first import of the payment graph (providers, ledger, supabase-js) is
  // the expensive one. Warm it inside a hook, where the hook timeout applies,
  // so no individual case is charged for module initialisation.
  await boot();
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  vi.resetModules();
});

const ADMIN = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_unit_test",
};
const LINKWA = {
  LINKWA_API_KEY: "sk_unit_test",
  LINKWA_BASE_URL: "https://api.linkwa.example",
  LINKWA_WEBHOOK_SECRET: "whsec_unit_test",
};
const PAYNOW = {
  PAYNOW_INTEGRATION_ID: "1201",
  PAYNOW_INTEGRATION_KEY: "integration-key-unit-test",
};

describe("ensurePaymentProvider", () => {
  it("stays on the honest default when nothing is configured", async () => {
    setEnv({});
    const { config, registry } = await boot();
    expect(config.isPaymentProviderConfigured()).toBe(false);
    expect(registry.getPaymentProvider().capabilities.configured).toBe(false);
    // Not a failure — an unconfigured deployment says so rather than pretending.
    expect(config.paymentBootError()).toBeNull();
  });

  it("activates Paynow only when both Paynow credentials and the ledger key exist", async () => {
    setEnv({ ...ADMIN, ...PAYNOW });
    const { config, registry } = await boot();
    expect(registry.getPaymentProvider().capabilities.configured).toBe(true);
    expect(config.paymentProviderDisplayName()).toBe("Paynow");
    expect(config.paymentBootError()).toBeNull();
  });

  it("refuses to activate Paynow without SUPABASE_SECRET_KEY, naming only the variable", async () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: ADMIN.NEXT_PUBLIC_SUPABASE_URL,
      ...PAYNOW,
    });
    const { config, registry } = await boot();
    expect(registry.getPaymentProvider().capabilities.configured).toBe(false);
    const reason = config.paymentBootError() ?? "";
    expect(reason).toContain("SUPABASE_SECRET_KEY");
    expect(reason).toContain("Paynow");
    // The reason is returned in API responses: it may name a variable, never a value.
    expect(reason).not.toContain(ADMIN.SUPABASE_SECRET_KEY);
    expect(reason).not.toContain(PAYNOW.PAYNOW_INTEGRATION_KEY);
  });

  it("gives complete Linkwa precedence over Paynow", async () => {
    setEnv({ ...ADMIN, ...LINKWA, ...PAYNOW });
    const { config, registry } = await boot();
    expect(registry.getPaymentProvider().capabilities.configured).toBe(true);
    expect(config.paymentProviderDisplayName()).toBe("Linkwa");
    expect(config.paymentBootError()).toBeNull();
  });

  it("fails closed on a half-set Linkwa instead of silently using Paynow", async () => {
    const partial = {
      ...ADMIN,
      ...PAYNOW,
      LINKWA_API_KEY: LINKWA.LINKWA_API_KEY,
      LINKWA_BASE_URL: LINKWA.LINKWA_BASE_URL,
      // webhook secret deliberately absent
    };
    setEnv(partial);
    const { config, registry } = await boot();
    expect(registry.getPaymentProvider().capabilities.configured).toBe(false);
    const reason = config.paymentBootError() ?? "";
    expect(reason).toContain("Linkwa configuration incomplete");
    expect(reason).toContain("LINKWA_WEBHOOK_SECRET");
    // The half-set provider must never quietly become the other one.
    expect(reason).not.toContain("Paynow credentials are present");
    expect(config.paymentProviderDisplayName()).not.toBe("Paynow");
    expect(reason).not.toContain(partial.LINKWA_API_KEY);
  });

  it("refuses to activate Linkwa without SUPABASE_SECRET_KEY", async () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: ADMIN.NEXT_PUBLIC_SUPABASE_URL,
      ...LINKWA,
      ...PAYNOW,
    });
    const { config, registry } = await boot();
    expect(registry.getPaymentProvider().capabilities.configured).toBe(false);
    expect(config.paymentBootError()).toContain("SUPABASE_SECRET_KEY");
    expect(config.paymentBootError()).not.toContain(LINKWA.LINKWA_API_KEY);
  });

  it("treats a .env.example placeholder as unset, not as a credential", async () => {
    setEnv({
      ...ADMIN,
      PAYNOW_INTEGRATION_ID: "1201",
      PAYNOW_INTEGRATION_KEY: "REPLACE_ME",
    });
    const { config, registry } = await boot();
    expect(registry.getPaymentProvider().capabilities.configured).toBe(false);
    expect(config.paymentBootError()).toContain("PAYNOW_INTEGRATION_KEY");
  });
});
