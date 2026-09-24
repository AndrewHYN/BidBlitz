import { expect, test } from "@playwright/test";
import { ACCOUNTS, createListing, signIn } from "./fixtures";

/**
 * THE transaction loop: a seller publishes an auction and a buyer bids the
 * floor price. Everything else in the suite depends on this path working.
 */
test.describe("transaction loop", () => {
  test("seller publishes and buyer1 bids at the floor", async ({ page }) => {
    test.setTimeout(240_000);

    // ---- seller signs in and publishes a listing --------------------------
    await signIn(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
    const auctionId = await createListing(page, { titlePrefix: "Loop" });

    // ---- buyer1 signs in and bids the floor -------------------------------
    await signIn(page, ACCOUNTS.buyer1.email, ACCOUNTS.buyer1.password);
    await page.goto(`/auction/${auctionId}`);

    await expect(page.getByTestId("auction-title")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("auction-status")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("bid-amount-input").fill("10");
    await page.getByTestId("place-bid-button").click();

    await expect(page.getByTestId("bid-success")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("current-bid")).toContainText(/\$?10\.00/, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("bid-count")).toContainText("1", { timeout: 30_000 });

    const rows = page.getByTestId("bid-history").getByTestId("bid-row");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
  });
});
