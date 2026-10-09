import { beforeEach, expect, it, vi } from "vitest";
import { requirePermission } from "@/server/permissions";
import { readLinkwaEnvironment } from "@/server/payments/config";
import { fetchLinkwaStatement } from "@/server/payments/linkwa-payouts";
import { GET } from "./route";

vi.mock("@/server/permissions", () => ({ requirePermission: vi.fn() }));
vi.mock("@/server/payments/config", () => ({ readLinkwaEnvironment: vi.fn() }));
vi.mock("@/server/payments/linkwa-payouts", () => ({ fetchLinkwaStatement: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue({ ok: true, userId: "admin" });
  vi.mocked(readLinkwaEnvironment).mockReturnValue({ state: "ready", missing: [], config: {
    apiKey: "PRIVATE", baseUrl: "https://linkwa.co.zw", webhookSecret: "SECRET",
  } });
});

it("denies unauthorised reads before accessing provider credentials", async () => {
  vi.mocked(requirePermission).mockResolvedValue({ ok: false, message: "Admins only." });
  expect((await GET()).status).toBe(403);
  expect(readLinkwaEnvironment).not.toHaveBeenCalled();
  expect(fetchLinkwaStatement).not.toHaveBeenCalled();
});

it("returns exact ledger amounts without personal descriptions or secrets and prevents caching", async () => {
  vi.mocked(fetchLinkwaStatement).mockResolvedValue([{
    id: "entry", type: "credit", currency: "USD", amountMinor: 120n,
    balanceAfterMinor: 120n, createdAt: "2026-10-09", recipientType: "user",
    description: "private recipient phone",
  }]);
  const result = await GET();
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await result.json();
  expect(body.entries[0].amountMinor).toBe("120");
  expect(JSON.stringify(body)).not.toMatch(/private recipient|PRIVATE|SECRET/);
  expect(body.warning).toContain("does not prove");
});

it("never returns an arbitrary provider exception", async () => {
  vi.mocked(fetchLinkwaStatement).mockRejectedValue(new Error("PRIVATE key and phone"));
  const result = await GET();
  expect(result.status).toBe(502);
  expect(await result.text()).not.toContain("PRIVATE");
});
