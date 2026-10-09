import { describe, expect, it } from "vitest";
import { describeLinkwaBalance } from "./balance-display";
import { fetchLinkwaBalance } from "./linkwa-payouts";

describe("Linkwa finance balance display", () => {
  it("treats a successful empty provider response as connected, without inventing funds", async () => {
    const balances = await fetchLinkwaBalance({
      apiKey: "test-key",
      baseUrl: "https://linkwa.co.zw",
      fetchImpl: async () => Response.json({ balances: [] }),
    });
    const display = describeLinkwaBalance(balances);
    expect(display).toMatchObject({ state: "connected", message: expect.stringContaining("no balance entries") });
    expect(display).not.toHaveProperty("availableMinor");
  });

  it("distinguishes a missing USD balance from an empty list", () => {
    expect(describeLinkwaBalance([{ currency: "ZWG", availableMinor: 500n, pendingMinor: 0n }]))
      .toMatchObject({ state: "connected", message: expect.stringContaining("no USD balance") });
  });

  it("retains an explicitly returned zero USD balance", () => {
    expect(describeLinkwaBalance([{ currency: "USD", availableMinor: 0n, pendingMinor: 0n }]))
      .toEqual({ state: "ready", availableMinor: 0n, pendingMinor: 0n });
  });

  it("keeps available and pending USD amounts separate and exact", () => {
    expect(describeLinkwaBalance([{ currency: "USD", availableMinor: 95n, pendingMinor: 190n }]))
      .toEqual({ state: "ready", availableMinor: 95n, pendingMinor: 190n });
  });

  it("does not reinterpret malformed provider data as a successful empty balance", async () => {
    await expect(fetchLinkwaBalance({
      apiKey: "test-key", baseUrl: "https://linkwa.co.zw",
      fetchImpl: async () => Response.json({}),
    })).rejects.toThrow("Linkwa did not return a balance list.");
  });
});
