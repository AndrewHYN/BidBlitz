import { expect, test } from "@playwright/test";
import { ACCOUNTS, createListing, signIn } from "./fixtures";

/**
 * Moderation from the outside: what ordinary users can do and, equally, what
 * they are refused.
 *
 * The admin console itself cannot run in a browser here - no test holds the
 * owner's credentials, and none ever will - so the server-authorized half
 * (triage, takedown, suspension, audit) is proven at the database boundary in
 * scripts/db/verify-engine.mjs instead. What the browser proves is the part a
 * person touches: reports can be filed, duplicates get an answer rather than
 * an error, and the admin area turns away everyone else.
 */
test.describe("moderation", () => {
  test("a signed-out visitor is sent to login from /admin", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/, { timeout: 30_000 });
  });

  test("a signed-in non-admin is refused the admin area", async ({ page }) => {
    await signIn(page, ACCOUNTS.buyer1.email, ACCOUNTS.buyer1.password);
    await page.goto("/admin");
    await expect(page.getByTestId("admin-empty")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Admins only")).toBeVisible({ timeout: 15_000 });
    // And the queue never renders for them - no rows, no controls.
    await expect(page.getByTestId("admin-report-row")).toHaveCount(0);
    await expect(page.getByTestId("admin-payout-row")).toHaveCount(0);
  });

  test("a buyer can report a listing, and a repeat report gets an answer", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signIn(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
    const auctionId = await createListing(page, { titlePrefix: "Moderation" });

    await signIn(page, ACCOUNTS.buyer1.email, ACCOUNTS.buyer1.password);
    await page.goto(`/auction/${auctionId}`);
    await expect(page.getByTestId("auction-title")).toBeVisible({ timeout: 30_000 });

    const report = page.getByTestId("report-button");
    await expect(report).toBeVisible({ timeout: 30_000 });
    await report.click();
    await page.locator("#report-reason").fill("Counterfeit serial number on this listing");
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByText("Report received")).toBeVisible({ timeout: 30_000 });

    // A second report on the same listing is not an error: the first one is
    // already queued, and the reporter is told exactly that.
    await report.click();
    await page.locator("#report-reason").fill("Reporting again with more detail here");
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByText("already reported")).toBeVisible({ timeout: 30_000 });
  });

  test("a profile page offers a user report to signed-in visitors", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.buyer1.email, ACCOUNTS.buyer1.password);
    await page.goto(`/profile/${ACCOUNTS.seller.username}`);
    await expect(page.getByTestId("profile-header")).toBeVisible({ timeout: 30_000 });
    const report = page.getByTestId("report-button");
    await expect(report).toBeVisible({ timeout: 30_000 });
    await expect(report).toContainText(`@${ACCOUNTS.seller.username}`);
  });

  test("your own profile offers no report control", async ({ page }) => {
    await signIn(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
    await page.goto(`/profile/${ACCOUNTS.seller.username}`);
    await expect(page.getByTestId("profile-header")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("report-button")).toHaveCount(0);
  });
});
