import { expect, test } from "@playwright/test";

const PUBLIC_ROUTES = [
  "/",
  "/browse",
  "/how-it-works",
  "/help",
  "/help/fees",
  "/help/rules",
  "/faq",
  "/about",
  "/terms",
  "/privacy",
  "/referrals",
  "/referrals?code=BB0123456789",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
] as const;

const PROTECTED_ROUTES = [
  "/dashboard",
  "/dashboard/buying",
  "/dashboard/selling",
  "/dashboard/watchlist",
  "/dashboard/transactions",
  "/dashboard/disputes",
  "/sell",
  "/settings",
  "/settings/payouts",
  "/settings/business",
  "/notifications",
  "/admin",
  "/admin/command",
  "/admin/marketing",
  "/admin/disputes",
  "/admin/finance",
  "/admin/finance/payouts",
  "/admin/finance/payments",
  "/admin/finance/costs",
  "/admin/finance/readiness",
  "/admin/support",
  "/admin/listings",
  "/support/tickets",
  "/support/tickets/00000000-0000-0000-0000-000000000000",
  "/admin/guide",
  "/admin/team",
  "/admin/team/accept?token=bidblitz-release-smoke-invalid-token",
  "/sell/00000000-0000-0000-0000-000000000000",
  "/dashboard/transactions/00000000-0000-0000-0000-000000000000",
  "/dashboard/disputes/00000000-0000-0000-0000-000000000000",
  "/admin/disputes/00000000-0000-0000-0000-000000000000",
] as const;

test.describe("release visual smoke", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} renders without overflow or fatal client errors`, async ({ page }) => {
      const fatal: string[] = [];
      page.on("pageerror", (error) => fatal.push(error.message));

      const response = await page.goto(route, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });

      expect(response?.status(), `${route} should return a page`).toBeLessThan(500);
      await expect(page.locator("body")).toBeVisible();

      const sizes = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        sizes.scrollWidth,
        `${route} should not horizontally overflow the viewport`
      ).toBeLessThanOrEqual(sizes.clientWidth + 2);

      expect(fatal, `${route} emitted a browser page error`).toEqual([]);
    });
  }

  for (const route of PROTECTED_ROUTES) {
    test(`${route} safely requires authentication`, async ({ page }) => {
      const fatal: string[] = [];
      page.on("pageerror", (error) => fatal.push(error.message));
      const response = await page.goto(route, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      expect(response?.status(), `${route} should not server-error`).toBeLessThan(500);
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
      expect(fatal, `${route} emitted a browser page error`).toEqual([]);
    });
  }

  test("dynamic public resources return real 404s without browser errors", async ({ page }) => {
    for (const route of [
      "/auction/not-a-valid-uuid",
      "/profile/bidblitz-release-smoke-user-that-does-not-exist",
      "/business/bidblitz-release-smoke-storefront-that-does-not-exist",
    ]) {
      const fatal: string[] = [];
      page.on("pageerror", (error) => fatal.push(error.message));
      const response = await page.goto(route, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      expect(response?.status(), `${route} should be a real 404`).toBe(404);
      await expect(page.locator("body")).toBeVisible();
      expect(fatal, `${route} emitted a browser page error`).toEqual([]);
    }
  });

  test("landing page exposes obvious marketplace actions", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("link", { name: /browse live auctions|browse auctions/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /sell an item|sell/i }).first()
    ).toBeVisible();
  });

  test("invite page explains consent and has a working login entry", async ({ page }) => {
    await page.goto("/referrals?code=BB0123456789", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("referral-program")).toBeVisible();
    await expect(page.getByRole("heading", { name: /bring the crowd/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in to continue/i })).toHaveAttribute("href", /\/login\?next=/);
    await expect(page.getByText(/no automatic cash rewards/i).first()).toBeVisible();
  });

  test("login has strong visible entry actions", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("login-form")).toBeVisible();
    await expect(page.getByTestId("google-sign-in-button")).toBeVisible();
    await expect(page.getByTestId("sign-in-button")).toBeVisible();
    await expect(page.getByTestId("otp-toggle-button")).toBeVisible();
  });

  test("signup keeps payout phone guidance visible before account creation", async ({ page }) => {
    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("signup-form")).toBeVisible();
    await expect(page.getByTestId("phone-field")).toBeVisible();
    await expect(page.getByTestId("sign-up-button")).toBeVisible();
  });
});
