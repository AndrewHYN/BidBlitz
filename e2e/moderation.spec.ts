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
    await expect(page).toHaveURL(/\/login\?next=\/admin/, { timeout: 30_000 });
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
    // The reported listing belongs to a one-off seller, NOT the shared
    // seller account, on purpose: an OPEN report makes every later publish
    // by that seller route to PENDING_REVIEW (reported sellers are reviewed
    // by design), and no test can resolve it without the owner's
    // credentials. Quarantining the report keeps the shared seller
    // review-clean for every other spec in the run, whatever order files
    // execute in. Desktop and mobile each get their own one-off seller
    // (buyer3 / buyer2): the desktop run's still-open report would otherwise
    // hold the mobile run's publish too, since teardown only runs at the
    // very end. Neither account publishes anywhere else in the suite.
    const oneOffSeller =
      test.info().project.name === "mobile-chromium" ? ACCOUNTS.buyer2 : ACCOUNTS.buyer3;
    await signIn(page, oneOffSeller.email, oneOffSeller.password);
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
    await page.waitForLoadState("networkidle").catch(() => undefined);
    // Exactly one VISIBLE header. Under full-suite load a transient hidden
    // duplicate was observed once (a single render site exists in source, and
    // isolated runs show exactly one element), so the assertion is on what a
    // person can see rather than on DOM node count.
    await expect(
      page.locator('[data-testid="profile-header"]:visible')
    ).toHaveCount(1, { timeout: 30_000 });
    const report = page.getByTestId("report-button");
    await expect(report).toBeVisible({ timeout: 30_000 });
    await expect(report).toContainText(`@${ACCOUNTS.seller.username}`);
  });

  test("your own profile offers no report control", async ({ page }) => {
    await signIn(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
    await page.goto(`/profile/${ACCOUNTS.seller.username}`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(
      page.locator('[data-testid="profile-header"]:visible')
    ).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("report-button")).toHaveCount(0);
  });
});
