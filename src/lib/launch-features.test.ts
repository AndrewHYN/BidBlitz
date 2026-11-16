import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("keeps auctions out of the public marketplace by default", async () => {
  vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_ENABLE_AUCTIONS", "");
  const { PUBLIC_AUCTIONS_ENABLED } = await import("./launch-features");
  expect(PUBLIC_AUCTIONS_ENABLED).toBe(false);
});

it("only enables auctions with an explicit true value", async () => {
  vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_ENABLE_AUCTIONS", "true");
  const { PUBLIC_AUCTIONS_ENABLED } = await import("./launch-features");
  expect(PUBLIC_AUCTIONS_ENABLED).toBe(true);
});
