import { expect, test } from "@playwright/test";
import { ACCOUNTS, TEST_PASSWORD, signIn } from "./fixtures";

test.describe("authentication", () => {
  test("a wrong password renders an auth error", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-form")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("email-field").fill(ACCOUNTS.seller.email);
    await page.getByTestId("password-field").fill("DefinitelyWrong!2026");
    await page.getByTestId("sign-in-button").click();

    await expect(page.getByTestId("auth-error")).toBeVisible({ timeout: 45_000 });
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });

  test("signing out from settings returns to a signed-out state", async ({ page }) => {
    test.setTimeout(240_000);

    await signIn(page, ACCOUNTS.buyer1.email);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-form")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("sign-out-button").click();

    // The contract defines no testid for the signed-out header, so probe the
    // observable behaviour instead: a signed-out visitor on /dashboard is
    // bounced to /login. Poll because sign-out may complete asynchronously.
    await expect
      .poll(
        async () => {
          await page.goto("/dashboard");
          return /\/login/.test(new URL(page.url()).pathname);
        },
        { timeout: 60_000, intervals: [2_000] }
      )
      .toBe(true);
  });

  test("signing up asks the user to confirm their email", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByTestId("signup-form")).toBeVisible({ timeout: 30_000 });

    const stamp = `${Date.now()}`;
    // example.com is RFC 2606 "reserved for documentation" — GoTrue rejects
    // the .test TLD outright (error_code=email_address_invalid), which made
    // this test red in every run for a reason that had nothing to do with our
    // flow. No mailbox is ever read; confirmation links go nowhere.
    await page.getByTestId("name-field").fill(`E2E ${stamp}`);
    await page
      .getByTestId("email-field")
      .or(page.locator('input[type="email"]'))
      .first()
      .fill(`e2e-${stamp}@example.com`);
    await page
      .getByTestId("password-field")
      .or(page.locator('input[type="password"]'))
      .first()
      .fill(TEST_PASSWORD);
    await page.getByTestId("sign-up-button").click();

    // Wait for one of exactly two honest outcomes: the check-email panel, or
    // an error surfaced on the form. Never a dashboard — auto-confirm is off.
    await expect(
      page
        .getByTestId("check-email-message")
        .or(page.getByTestId("auth-error"))
        .first()
    ).toBeVisible({ timeout: 60_000 });

    const authError = page.getByTestId("auth-error");
    if (await authError.isVisible()) {
      const detail = (await authError.innerText()).trim();
      // Supabase Auth rate-limits confirmation emails
      // (over_email_send_rate_limit -> our "Too many attempts" copy). That is
      // a provider quota state, not a defect in this flow, so record it as an
      // explicit skip instead of a false red. Any other rejection fails with
      // the real message so it cannot hide.
      if (/too many attempts/i.test(detail)) {
        test.skip(true, `provider email quota exhausted: ${detail}`);
      }
      throw new Error(`signup was rejected: ${detail}`);
    }

    // Email confirmation is ON: the flow must stop at the check-your-email
    // message and must NOT land the user in an authenticated area.
    await expect(page).not.toHaveURL(/\/dashboard/);
  });
});
