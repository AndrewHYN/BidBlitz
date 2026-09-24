import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS, createListing, signIn } from "./fixtures";

/**
 * Two buyers race the same auction. The engine serialises on the auction row,
 * so afterwards BOTH pages must agree on exactly one price — the price is
 * never summed, duplicated or corrupted — and the bid count must match the
 * number of accepted bids.
 */
test.describe("concurrency", () => {
  test("near-simultaneous bids settle to exactly one consistent price", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    // ---- seller publishes (floor 10, increment 1) -------------------------
    const sellerContext = await browser.newContext();
    const sellerPage = await sellerContext.newPage();
    await signIn(sellerPage, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
    const auctionId = await createListing(sellerPage, { titlePrefix: "Race" });
    await sellerContext.close();

    // ---- two buyer contexts, bidding "at the same time" -------------------
    const context2 = await browser.newContext();
    const context3 = await browser.newContext();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();

    try {
      await signIn(page2, ACCOUNTS.buyer2.email);
      await signIn(page3, ACCOUNTS.buyer3.email);

      await Promise.all([
        page2.goto(`/auction/${auctionId}`),
        page3.goto(`/auction/${auctionId}`),
      ]);
      await expect(page2.getByTestId("bid-amount-input")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page3.getByTestId("bid-amount-input")).toBeVisible({
        timeout: 30_000,
      });

      await page2.getByTestId("bid-amount-input").fill("11");
      await page3.getByTestId("bid-amount-input").fill("13");

      await Promise.all([
        page2.getByTestId("place-bid-button").click(),
        page3.getByTestId("place-bid-button").click(),
      ]);

      // Each context must land on exactly one outcome.
      const outcome = async (page: Page): Promise<boolean> => {
        const success = page.getByTestId("bid-success");
        const error = page.getByTestId("bid-error");
        await expect(success.or(error)).toBeVisible({ timeout: 45_000 });
        return success.isVisible();
      };
      const [ok2, ok3] = await Promise.all([outcome(page2), outcome(page3)]);

      const successes = (ok2 ? 1 : 0) + (ok3 ? 1 : 0);
      const errors = (ok2 ? 0 : 1) + (ok3 ? 0 : 1);
      // The first bid above the floor always lands; at most one loses the race.
      expect(successes).toBeGreaterThanOrEqual(1);
      expect(errors).toBeLessThanOrEqual(1);

      // ---- both pages must now agree on the settled price ------------------
      await Promise.all([page2.reload(), page3.reload()]);
      await expect(page2.getByTestId("current-bid")).toBeVisible({ timeout: 30_000 });
      await expect(page3.getByTestId("current-bid")).toBeVisible({ timeout: 30_000 });

      const price2 = (await page2.getByTestId("current-bid").textContent()) ?? "";
      const price3 = (await page3.getByTestId("current-bid").textContent()) ?? "";
      expect(price3).toBe(price2);

      // ...and it must be EXACTLY ONE of the two submitted amounts.
      const isEleven = /\$?11\.00/.test(price2);
      const isThirteen = /\$?13\.00/.test(price2);
      expect(Number(isEleven) + Number(isThirteen)).toBe(1);

      // The count must agree across contexts and match the accepted bids.
      const count2 = (await page2.getByTestId("bid-count").textContent()) ?? "";
      const count3 = (await page3.getByTestId("bid-count").textContent()) ?? "";
      expect(count3).toBe(count2);
      expect(count2).toContain(String(successes));
    } finally {
      await context2.close();
      await context3.close();
    }
  });
});
