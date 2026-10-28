import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each(["https://bidblitz.co.zw", "https://bidblitz.co.zw/", "https://www.bidblitz.co.zw/"])(
  "uses the final production origin when configured as %s", async (value) => {
    vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_SITE_URL", value);
    const { SITE_URL, CANONICAL_SITE_URL, absoluteUrl, canonicalUrl } = await import("./site-url");
    expect(SITE_URL).toBe(value.replace(/\/+$/, ""));
    expect(CANONICAL_SITE_URL).toBe("https://www.bidblitz.co.zw");
    expect(canonicalUrl("/browse")).toBe("https://www.bidblitz.co.zw/browse");
    expect(absoluteUrl("/auth/callback")).toBe(`${SITE_URL}/auth/callback`);
  }
);

it("preserves a local or isolated preview origin", async () => {
  vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000/");
  const { SITE_URL } = await import("./site-url");
  expect(SITE_URL).toBe("http://127.0.0.1:3000");
});
