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

    // The selling dashboard names the outcome and offers no relist: a
    // cancelled auction was withdrawn, not unsold, and must not be
    // one click away from a fresh listing.
    await page.goto("/dashboard/selling");
    await expect(
      page.getByText("This auction was cancelled before anyone bid.")
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "List again" })).toHaveCount(0);
  });
});
