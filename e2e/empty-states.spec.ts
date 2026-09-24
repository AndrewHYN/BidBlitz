import { expect, test } from "@playwright/test";
import { ACCOUNTS, signIn } from "./fixtures";

/**
 * A freshly signed-in account sees well-defined empty states (or real
 * content, if earlier runs left data behind) instead of broken pages.
 */
test.describe("empty states", () => {
  test("account pages and browse render content or a proper empty state", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    await signIn(page, ACCOUNTS.buyer3.email, ACCOUNTS.buyer3.password);

    await page.goto("/dashboard/watchlist");
    await expect(
      page.getByTestId("empty-state").or(page.getByTestId("watchlist-grid")).first()
    ).toBeVisible({ timeout: 30_000 });

    await page.goto("/dashboard/transactions");
    await expect(
      page.getByTestId("empty-state").or(page.getByTestId("transactions-table")).first()
    ).toBeVisible({ timeout: 30_000 });

    await page.goto("/notifications");
    await expect(
      page.getByTestId("empty-state").or(page.getByTestId("notifications-list")).first()
    ).toBeVisible({ timeout: 30_000 });

    await page.goto("/browse");
    await expect(page.getByTestId("browse-filters")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId("browse-grid").or(page.getByTestId("empty-state")).first()
    ).toBeVisible({ timeout: 30_000 });
  });
});
