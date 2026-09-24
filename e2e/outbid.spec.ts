import { expect, test } from "@playwright/test";
import { ACCOUNTS, createListing, signIn } from "./fixtures";

/**
 * Outbid flow: buyer2 raises buyer1, buyer1's stale amount must be rejected
 * with the exact new minimum, and the winning/outbid state moves with the
 * price.
 */
test.describe("outbid", () => {
  test("a higher bid wins and the stale amount is told the new floor", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    // ---- seller publishes (floor 10, increment 1) -------------------------
    await signIn(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
    const auctionId = await createListing(page, { titlePrefix: "Outbid" });

    // ---- buyer1 opens the bidding at the floor ----------------------------
    await signIn(page, ACCOUNTS.buyer1.email);
    await page.goto(`/auction/${auctionId}`);
    await page.getByTestId("bid-amount-input").fill("10");
    await page.getByTestId("place-bid-button").click();
    await expect(page.getByTestId("bid-success")).toBeVisible({ timeout: 30_000 });

    // ---- buyer2 outbids ---------------------------------------------------
    await signIn(page, ACCOUNTS.buyer2.email);
    await page.goto(`/auction/${auctionId}`);
    await page.getByTestId("bid-amount-input").fill("11");
    await page.getByTestId("place-bid-button").click();
    await expect(page.getByTestId("bid-success")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("current-bid")).toContainText(/\$?11\.00/, {
      timeout: 30_000,
    });

    // buyer2 now holds the winning state
    await expect(page.getByTestId("winning-badge").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.goto("/dashboard/buying");
    await expect(page.getByTestId("buying-list")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("winning-badge").first()).toBeVisible({
      timeout: 30_000,
    });

    // ---- buyer1 retries the old amount ------------------------------------
    await signIn(page, ACCOUNTS.buyer1.email);
    await page.goto(`/auction/${auctionId}`);
    await expect(page.getByTestId("current-bid")).toContainText(/\$?11\.00/, {
      timeout: 30_000,
    });
    await page.getByTestId("bid-amount-input").fill("10");
    await page.getByTestId("place-bid-button").click();

    const error = page.getByTestId("bid-error");
    await expect(error).toBeVisible({ timeout: 30_000 });
    // next minimum = 11 + 1 = 12 -> the message must name it
    await expect(error).toContainText(/12/);

    // buyer1's dashboard reflects the outbid state
    await page.goto("/dashboard/buying");
    await expect(page.getByTestId("outbid-badge").first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
