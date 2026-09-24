import { expect, test } from "@playwright/test";
import { ACCOUNTS, createListing, signIn } from "./fixtures";

/**
 * Countdown + closing behaviour.
 *
 * A true anti-snipe extension would require waiting out the final seconds of
 * an auction, which no sell duration allows within a test run — so this spec
 * proves the observable half: the live countdown ticks, and once the server
 * closes the auction (here: the seller cancels it, a terminal status) the
 * panel flips to the closed state and the bid button is gone.
 */
test.describe("countdown and closing", () => {
  test("countdown ticks while live and bidding disappears once closed", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    const sellerContext = await browser.newContext();
    const buyerContext = await browser.newContext();
    const sellerPage = await sellerContext.newPage();
    const buyerPage = await buyerContext.newPage();

    try {
      // ---- a fresh LIVE auction with ~1 hour on the clock -----------------
      await signIn(sellerPage, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
      const auctionId = await createListing(sellerPage, { titlePrefix: "Countdown" });

      await signIn(buyerPage, ACCOUNTS.buyer1.email);
      await buyerPage.goto(`/auction/${auctionId}`);

      const countdown = buyerPage.getByTestId("countdown");
      await expect(countdown).toBeVisible({ timeout: 45_000 });
      await expect(buyerPage.getByTestId("auction-closed-panel")).toBeHidden({
        timeout: 15_000,
      });
      await expect(buyerPage.getByTestId("place-bid-button")).toBeVisible({
        timeout: 30_000,
      });

      // ---- it is ticking: two reads a couple of seconds apart differ -------
      const firstRead = (await countdown.textContent()) ?? "";
      expect(firstRead.trim().length).toBeGreaterThan(0);
      await buyerPage.waitForTimeout(2_500);
      const secondRead = (await countdown.textContent()) ?? "";
      expect(secondRead).not.toBe(firstRead);

      // ---- the seller closes the auction ----------------------------------
      await sellerPage.goto(`/sell/${auctionId}`);
      await expect(sellerPage.getByTestId("cancel-auction-button")).toBeVisible({
        timeout: 30_000,
      });
      await sellerPage.getByTestId("cancel-auction-button").click();

      // If cancellation asks for confirmation inside a dialog, confirm it.
      // (Native confirm() dialogs are auto-accepted by Playwright.)
      const dialog = sellerPage.getByRole("dialog");
      if (await dialog.isVisible().catch(() => false)) {
        const confirm = dialog.getByRole("button", {
          name: /confirm|yes|cancel auction|ok/i,
        });
        if (await confirm.first().isVisible().catch(() => false)) {
          await confirm.first().click();
        }
      }

      // ---- the buyer's view must land on the closed panel -----------------
      await expect(async () => {
        await buyerPage.reload();
        await expect(
          buyerPage.getByTestId("auction-closed-panel")
        ).toBeVisible({ timeout: 10_000 });
      }).toPass({ timeout: 90_000, intervals: [3_000] });

      await expect(buyerPage.getByTestId("place-bid-button")).toBeHidden({
        timeout: 15_000,
      });
      await expect(buyerPage.getByTestId("auction-status")).toContainText(
        /cancel|ended|closed|unsold/i,
        { timeout: 15_000 }
      );
    } finally {
      await sellerContext.close();
      await buyerContext.close();
    }
  });
});
