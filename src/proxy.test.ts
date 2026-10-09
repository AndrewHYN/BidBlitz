import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle };
  const from = vi.fn();
  return { query, from, getSession: vi.fn() };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ from: mock.from, auth: { getSession: mock.getSession } }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://bidblitz-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  mock.from.mockReset().mockReturnValue(mock.query);
  mock.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  for (const fn of [mock.query.select, mock.query.eq, mock.query.is]) fn.mockReset().mockReturnValue(mock.query);
  mock.query.maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("public resource HTTP routing", () => {
  it("returns a noindexed 404 for a missing or inaccessible active storefront", async () => {
    const { proxy } = await import("./proxy");
    const response = await proxy(new NextRequest("https://www.bidblitz.co.zw/business/missing-store"));
    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://www.bidblitz.co.zw/resource-not-found");
    expect(response.headers.get("x-middleware-request-x-bidblitz-missing")).toBe("business");
    expect(mock.from).toHaveBeenCalledWith("business_sellers");
    expect(mock.query.eq).toHaveBeenCalledWith("slug", "missing-store");
    expect(mock.query.eq).toHaveBeenCalledWith("status", "ACTIVE");
  });

  it("leaves an existing active storefront renderable", async () => {
    mock.query.maybeSingle.mockResolvedValue({ data: { id: "store-id" }, error: null });
    const { proxy } = await import("./proxy");
    const response = await proxy(new NextRequest("https://www.bidblitz.co.zw/business/real-store"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBeNull();
  });

  it("does not report a database failure as a confirmed missing storefront", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.query.maybeSingle.mockResolvedValue({ data: null, error: { message: "Temporary database failure" } });
    const { proxy } = await import("./proxy");
    const response = await proxy(new NextRequest("https://www.bidblitz.co.zw/business/real-store"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("strips a spoofed missing-resource header from a real storefront", async () => {
    mock.query.maybeSingle.mockResolvedValue({ data: { id: "store-id" }, error: null });
    const { proxy } = await import("./proxy");
    const response = await proxy(new NextRequest("https://www.bidblitz.co.zw/business/real-store", {
      headers: { "x-bidblitz-missing": "business" },
    }));
    expect(response.headers.get("x-middleware-override-headers") ?? "").not.toContain("x-bidblitz-missing");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it.each(["/auction/not-a-uuid", "/profile/missing-profile"])("keeps the existing missing-resource guard for %s", async (path) => {
    const { proxy } = await import("./proxy");
    const response = await proxy(new NextRequest(`https://www.bidblitz.co.zw${path}`));
    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("does not add public resource queries to dashboard routes", async () => {
    const { proxy } = await import("./proxy");
    await proxy(new NextRequest("https://www.bidblitz.co.zw/dashboard"));
    expect(mock.from).not.toHaveBeenCalled();
    expect(mock.getSession).toHaveBeenCalledOnce();
  });
});
