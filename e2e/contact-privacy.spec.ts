import { expect, test } from "@playwright/test";

/** Anonymous visitors can see item descriptions but cannot scrape a seller number from the HTML. */
test("public listing HTML does not include seller tel or WhatsApp links", async ({ page }) => {
  await page.goto("/browse");
  const card = page.getByTestId("auction-card").first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByRole("heading", { name: /.+/ }).first()).toBeVisible();
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.locator('a[href^="https://wa.me/"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Sign in to view seller contact/ })).toBeVisible();
  await expect(page.getByText(/account sales|completed sales/i)).toHaveCount(0);
});
