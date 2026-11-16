import { expect, test } from "@playwright/test";

test("category navigation uses human labels", async ({ page }) => {
  await page.goto("/");
  const categories = page.getByTestId("home-category-chips");
  await expect(categories.getByRole("link", { name: "Toys & Hobbies" })).toBeVisible();
  await expect(categories).not.toContainText("/browse?category=toys-hobbies");
});

test("live listing card has informative photo text and no generic Town label", async ({ page }) => {
  await page.goto("/browse");
  const cards = page.getByTestId("auction-card");
  await expect(cards.first()).toBeVisible();
  const img = cards.first().locator("img").first();
  await expect(img).toHaveAttribute("alt", /.+, photo 1/);
  await expect(cards.first().getByText("Town", { exact: true })).toHaveCount(0);
});
