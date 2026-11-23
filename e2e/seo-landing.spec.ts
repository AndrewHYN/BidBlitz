import { expect, test } from "@playwright/test";

for (const target of [
  { path: "/marketplace/harare", heading: "Buy and sell locally in Harare" },
  { path: "/services-zimbabwe", heading: "Find local services in Zimbabwe" },
]) {
  test(`${target.path} has a crawlable identity and useful internal links`, async ({ page }) => {
    const response = await page.goto(target.path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: target.heading })).toBeVisible();
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute("href", `https://www.bidblitz.co.zw${target.path}`);
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: /browse all/i }).first()).toBeVisible();
  });
}

test("new SEO landing routes are internally linked and sitemapped", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('a[href="/marketplace/harare"]').first()).toBeVisible();
  await expect(page.locator('a[href="/services-zimbabwe"]').first()).toBeVisible();
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  expect(xml).toContain("https://www.bidblitz.co.zw/marketplace/harare");
  expect(xml).toContain("https://www.bidblitz.co.zw/services-zimbabwe");
});
