import { expect, test } from "@playwright/test";

const CANONICAL_ORIGIN = process.env.PLAYWRIGHT_CANONICAL_ORIGIN ?? "https://www.bidblitz.co.zw";

test("sitemap URLs resolve directly and declare their own canonical", async ({ request }) => {
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const urls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(urls.length).toBeGreaterThanOrEqual(10);
  for (const url of urls) {
    expect(new URL(url).origin).toBe(CANONICAL_ORIGIN);
    const path = new URL(url).pathname;
    const page = await request.get(path, { maxRedirects: 0 });
    expect(page.status(), path).toBe(200);
    const canonical = (await page.text()).match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/);
    expect(canonical, path).not.toBeNull();
    expect(new URL(canonical![1]).href, path).toBe(new URL(url).href);
  }
});

test("auction breadcrumbs identify every entry as a ListItem", async ({ page, request }) => {
  const response = await request.get("/sitemap.xml");
  const auction = (await response.text()).match(/<loc>([^<]+\/auction\/[^<]+)<\/loc>/);
  expect(auction, "A public auction is required to verify rendered structured data").not.toBeNull();
  expect(new URL(auction![1]).origin).toBe(CANONICAL_ORIGIN);
  await page.goto(new URL(auction![1]).pathname);
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const nodes = blocks.flatMap((block) => {
    const data = JSON.parse(block);
    return data["@graph"] ?? [data];
  });
  const breadcrumbs = nodes.find((node) => node["@type"] === "BreadcrumbList");
  expect(breadcrumbs).toBeDefined();
  expect(breadcrumbs.itemListElement.length).toBeGreaterThanOrEqual(3);
  for (const item of breadcrumbs.itemListElement) {
    expect(item["@type"]).toBe("ListItem");
    expect(item.name).toBeTruthy();
    expect(new URL(item.item).origin).toBe(CANONICAL_ORIGIN);
  }
});

test("legacy public hosts permanently redirect with path and query intact", async ({ request }) => {
  for (const host of ["bidblitz.co.zw", "bid-blitz-ten.vercel.app"]) {
    const response = await request.get("/browse?category=computers-laptops", {
      headers: { host }, maxRedirects: 0,
    });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe("https://www.bidblitz.co.zw/browse?category=computers-laptops");
  }
});
