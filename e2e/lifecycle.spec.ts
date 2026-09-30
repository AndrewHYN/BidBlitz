import { expect, test } from "@playwright/test";
import { ACCOUNTS, createListing, signIn } from "./fixtures";

/**
 * The cancellation lifecycle from the outside: what sellers can do at each
 * state, and what they are refused.
 *
 * The admin half (approving requests, pausing, resuming, review decisions)
 * cannot run in a browser here - no test holds the owner's credentials, and
 * none ever will - so it is proven at the database boundary in
 * scripts/db/verify-engine.mjs (the LC: checks) instead. What the browser
 * proves is the part a person touches: the right control appears for the
 * right state, the wrong control never appears, and a submitted request is
 * acknowledged.
 */
test.describe("auction lifecycle", () => {
  test("a seller ends a no-bid auction early with a reason", async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
    const auctionId = await createListing(page, { titlePrefix: "Lifecycle" });

    await page.goto(`/sell/${auctionId}`);
    const cancel = page.getByTestId("cancel-auction-button");
    await expect(cancel).toBeVisible({ timeout: 30_000 });
    await cancel.click();

    // A reason is required past DRAFT: pick one from the controlled list.
    await page.getByTestId("cancel-reason").click();
    await page.getByRole("option", { name: "Item was damaged" }).click();
    await page.getByRole("button", { name: "Yes, cancel it" }).click();

    // The control is gone because the auction is closed...
    await expect(cancel).toHaveCount(0, { timeout: 30_000 });
    // ...and the public page says what happened.
    await page.goto(`/auction/${auctionId}`);
    await expect(page.getByText("Cancelled").first()).toBeVisible({ timeout: 30_000 });
  });

  test("an auction with bids offers a request, never a silent cancel", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await signIn(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
    const auctionId = await createListing(page, { titlePrefix: "Lifecycle" });

    await signIn(page, ACCOUNTS.buyer1.email);
    await page.goto(`/auction/${auctionId}`);
    await page.getByTestId("bid-amount-input").fill("10");
    await page.getByTestId("place-bid-button").click();
    await expect(page.getByTestId("bid-success")).toBeVisible({ timeout: 30_000 });

    await signIn(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
    await page.goto(`/sell/${auctionId}`);
    // No direct cancel once bids exist...
    await expect(page.getByTestId("cancel-auction-button")).toHaveCount(0);
    // ...only the request path, which names the consequence up front.
    const request = page.getByTestId("request-cancellation-button");
    await expect(request).toBeVisible({ timeout: 30_000 });
    await request.click();
    await page.getByTestId("cancel-request-reason").click();
    await page.getByRole("option", { name: "Item was damaged" }).click();
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByText("Cancellation requested")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("email preferences persist and critical mail is not listed", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, ACCOUNTS.buyer1.email, ACCOUNTS.buyer1.password);
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "Email notifications" })
    ).toBeVisible({ timeout: 30_000 });

    // Critical mail is stated as always-on; only the optional toggles exist.
    await expect(page.getByText("always arrive")).toBeVisible();
    const outbid = page.getByLabel("Outbid alerts");
    await expect(outbid).toBeVisible();
    await outbid.click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 30_000 });
    const turnedOff = await outbid.getAttribute("aria-checked");
    await page.reload();
    await expect(page.getByLabel("Outbid alerts")).toHaveAttribute(
      "aria-checked",
      turnedOff ?? "true",
      { timeout: 30_000 }
    );
    // Leave the account as found.
    if (turnedOff === "false") await page.getByLabel("Outbid alerts").click();
  });

  test("a non-admin sees no admin entry and is kept out of /admin/team", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.buyer1.email, ACCOUNTS.buyer1.password);
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByTestId("admin-menu-link")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/admin/team");
    await expect(page).toHaveURL(/\/admin(\?.*)?$/, { timeout: 30_000 });
    await expect(page.getByText("Admins only")).toBeVisible({ timeout: 30_000 });
  });
});
