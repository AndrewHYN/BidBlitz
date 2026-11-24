import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
});

describe("contact reveal server action", () => {
  it("rejects invalid listing identifiers before creating a client", async () => {
    const { revealListingContactAction } = await import("./listing-contact");
    expect(await revealListingContactAction({ listingId: "not-a-uuid" })).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("never reveals contact details without a signed-in user", async () => {
    const { revealListingContactAction } = await import("./listing-contact");
    const result = await revealListingContactAction({ listingId: "00000000-0000-4000-8000-000000000000" });
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("uses a server-authorized RPC that logs and rate-limits contact reveals", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "viewer" } } });
    mocks.rpc.mockResolvedValue({ data: "+263771234567", error: null });
    const { revealListingContactAction } = await import("./listing-contact");
    const result = await revealListingContactAction({ listingId: "00000000-0000-4000-8000-000000000000" });
    expect(mocks.rpc).toHaveBeenCalledWith("reveal_listing_contact", { p_listing_id: "00000000-0000-4000-8000-000000000000" });
    expect(result).toEqual({ ok: true, phone: "+263771234567" });
  });
  it.each(["+27821234567", "+26878123456", "+447700900123"])("reveals international contact %s after authorization", async (phone) => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "viewer" } } });
    mocks.rpc.mockResolvedValue({ data: phone, error: null });
    const { revealListingContactAction } = await import("./listing-contact");
    expect(await revealListingContactAction({ listingId: "00000000-0000-4000-8000-000000000000" })).toEqual({ ok: true, phone });
  });

  it("rejects unsafe contact values even after RPC authorization", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "viewer" } } });
    mocks.rpc.mockResolvedValue({ data: "javascript:alert(1)", error: null });
    const { revealListingContactAction } = await import("./listing-contact");
    expect(await revealListingContactAction({ listingId: "00000000-0000-4000-8000-000000000000" })).toMatchObject({ ok: false });
  });
});
