import { expect, test } from "@playwright/test";
import { ACCOUNTS, signIn, waitForHydratedForm } from "./fixtures";

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
  "/dashboard/account",
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
  test("footer links are reachable on small and large screens", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/help");
    const footer = page.locator("[data-site-footer]");
    const support = footer.locator("summary").filter({ hasText: /^Support$/ });
    const safety = footer.getByRole("link", { name: "Safety & Trust Centre" });
    await expect(safety).toBeHidden();
    await support.focus();
    await page.keyboard.press("Enter");
    await expect(safety).toBeVisible();
    await expect(safety).toHaveAttribute("href", "/safety");
    await support.press("Enter");
    await expect(safety).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(safety).toBeVisible();
  });

  test("signed-in navigation stays reachable across the tablet breakpoint", async ({ page }) => {
    await signIn(page, ACCOUNTS.buyer1.email);
    await page.goto("/messages");
    const dock = page.getByRole("navigation", { name: "Quick navigation" });
    const desktop = page.getByRole("navigation", { name: "Primary" });
    for (const width of [320, 768, 1023]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(dock.getByRole("link", { name: "Chat" })).toBeInViewport();
      await expect(desktop).toBeHidden();
    }
    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(desktop.getByRole("link", { name: "Messages" })).toBeInViewport();
    await expect(dock).toBeHidden();
  });

  test("signed-in users can open their sales account without overflow", async ({ page }, testInfo) => {
    await signIn(page, ACCOUNTS.buyer1.email);
    await page.goto("/dashboard/account");
    await expect(page.getByRole("heading", { name: "Your sales account", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "USD sales balances" })).toBeVisible();
    const mobileNav = (page.viewportSize()?.width ?? 0) < 1024;
    const nav = page.getByRole("navigation", { name: mobileNav ? "Quick navigation" : "Primary" });
    const chatLink = nav.getByRole("link", { name: mobileNav ? "Chat" : "Messages", exact: true });
    await expect(chatLink).toHaveAttribute("href", "/messages");
    await expect(chatLink).toBeInViewport({ ratio: 0.99 });
    await expect(page.getByRole("heading", { name: "Sales account unavailable" })).toHaveCount(0);
    const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.viewport + 2);
    await page.screenshot({ path: testInfo.outputPath("sales-account.png"), fullPage: true });
  });
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
      "/listing/not-a-valid-uuid",
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

  test("home location opens from the corner pin and returns focus on Escape", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    const pin = page.getByRole("button", { name: /^Change location, currently / });
    const panel = page.getByRole("dialog", { name: "Listing location" });
    await expect(panel).toBeHidden();
    await pin.focus();
    await pin.press("Enter");
    await expect(panel.getByLabel("Town or suburb")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(pin).toBeFocused();
  });

  test("landing page exposes obvious marketplace actions", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("link", { name: /^browse listings$/i }).first()
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
    await expect(page.getByText(/automatic cash rewards/i).first()).toBeVisible();
  });

  test("login has strong visible entry actions", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="login-form"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="google-sign-in-button"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-button"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="otp-toggle-button"]:visible')).toBeVisible();
  });

  test("premium login is usable on a narrow phone and keeps password and code flows", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/login");
    await waitForHydratedForm(page, "login-form");

    await expect(page.getByRole("heading", { name: /welcome back/i }).first()).toBeVisible();
    await expect(page.locator('[data-testid="google-sign-in-button"]:visible').first()).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-button"]:visible').first()).toBeVisible();
    await expect(page.locator('[data-testid="otp-toggle-button"]:visible').first()).toBeVisible();
    await expect(page.getByRole("link", { name: /create an account/i }).first()).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: /forgot your password/i }).first()).toHaveAttribute("href", "/forgot-password");

    const password = page.locator('[data-testid="password-field"]:visible').first();
    await password.fill("not-a-real-password-just-testing");
    await expect(password).toHaveAttribute("type", "password");
    await page.locator('[data-testid="toggle-password-visibility"]:visible').first().click();
    await expect(password).toHaveAttribute("type", "text");
    await page.locator('[data-testid="toggle-password-visibility"]:visible').first().click();
    await expect(password).toHaveAttribute("type", "password");

    await page.locator('[data-testid="email-field"]:visible').first().fill("seller@example.com");
    await page.locator('[data-testid="otp-toggle-button"]:visible').first().click();
    await expect(page.locator('[data-testid="email-field"]:visible').first()).toHaveValue("seller@example.com");
    await expect(page.locator('[data-testid="send-code-button"]:visible').first()).toBeVisible();
    await page.locator('[data-testid="otp-back-button"]:visible').first().click();
    await expect(page.locator('[data-testid="sign-in-button"]:visible').first()).toBeVisible();

    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.viewport + 2);
  });

  test("signup keeps payout phone guidance visible before account creation", async ({ page }) => {
    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="signup-form"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="phone-field"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="sign-up-button"]:visible')).toBeVisible();
  });
});
