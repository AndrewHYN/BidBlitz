import { expect, test } from "@playwright/test";
import { ACCOUNTS, createListing, signIn } from "./fixtures";

/**
 * Relist gating: "List again" exists for UNSOLD auctions and only for them.
 *
 * The positive path (an UNSOLD auction becoming a new draft) cannot run in
 * browser time: the shortest sell duration is an hour, so no auction ends
 * unsold inside a test run. The authorization shape is pinned by unit tests
 * instead (src/server/actions/auction-relist.test.ts). What the browser proves
 * here is the gate the seller actually sees: a CANCELLED auction - withdrawn
 * on purpose, not rejected by the market - offers no "List again", and says
 * plainly what happened to it.
 *
 * Assertions are scoped to this run's auction row (by its link), because both
 * Playwright projects share the seller account and may each hold a cancelled
 * fixture at once. A page-wide count would couple this test to whatever the
 * other project is doing.
 */
test.describe("relist gating", () => {
  test("a cancelled auction offers no List again action", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
    const auctionId = await createListing(page, { titlePrefix: "Relist" });

    // Close it the way a seller closes a live auction with no bids.
    await page.goto(`/sell/${auctionId}`);
    await expect(page.getByTestId("cancel-auction-button")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("cancel-auction-button").click();
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible().catch(() => false)) {
      const confirm = dialog.getByRole("button", {
        name: /confirm|yes|cancel auction|ok/i,
      });
      if (await confirm.first().isVisible().catch(() => false)) {
        await confirm.first().click();
      }
    }

    // The selling dashboard names the outcome on our auction's own row - and
    // that row, a cancelled auction that was withdrawn rather than unsold,
    // carries no "List again" action.
    //
    // Retried as a unit because the cancellation above is eventually
    // consistent from the browser's point of view: under full-suite load the
    // server round trip can still be in flight when the first navigation
    // lands, and a LIVE row links to /sell/ instead of /auction/. Polling the
    // navigation plus the assertion keeps a slow backend from failing the
    // test without weakening what is asserted.
    await expect(async () => {
      await page.goto("/dashboard/selling");
      const row = page.locator("li", {
        has: page.locator(`a[href="/auction/${auctionId}"]`),
      });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(
        row.getByText("This auction was cancelled before anyone bid.")
      ).toBeVisible({ timeout: 15_000 });
      await expect(row.getByRole("button", { name: "List again" })).toHaveCount(0);
    }).toPass({ timeout: 120_000 });
  });
});
