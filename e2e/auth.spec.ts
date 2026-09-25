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
    // observable behaviour instead: a signed-out visitor on /dashboard ends up
    // at /login. Ground truth (traced + curl-verified in production 2026-09-25):
    //   - src/proxy.ts (Next 16's middleware) exists but only refreshes
    //     sessions — by design it never authorizes or redirects.
    //   - /dashboard DOES gate server-side (`redirect("/login?next=/dashboard")`
    //     in the page), but /dashboard/loading.tsx flushes the shell first, so
    //     the document response is already committed as HTTP 200 + skeleton
    //     (anonymous curl: 200, no dashboard-stats, `login?next` markers in the
    //     RSC payload) and the redirect then arrives through the stream. The
    //     browser follows it ~0.6–1s after load.
    //   - sign-out deletes the auth cookie via `Set-Cookie Max-Age=0`, so every
    //     follow-up request is cookieless.
    // Reading the URL synchronously right after goto() therefore only ever
    // observes the pre-redirect shell. Wait for that navigation inside each
    // poll iteration; poll because sign-out may complete asynchronously, and
    // the per-iteration wait keeps the test red if the bounce never lands.
    await expect
      .poll(
        async () => {
          await page.goto("/dashboard");
          await page
            .waitForURL(/\/login/, { timeout: 10_000 })
            .catch(() => undefined);
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
    // Ground truth (probed 2026-09-25 against this project's GoTrue):
    //   e2e-<ts>@example.com -> 400 email_address_invalid
    //   e2e-<ts>@gmail.com   -> 200 signup + confirmation email accepted
    // GoTrue's mailer email validation blocklists example.com in
    // invalidHostMap (validateclient.go) — RFC 2606 addresses are rejected
    // with "Email address ... is invalid", which our friendlyAuthError maps
    // to "Enter a valid email address." The .test TLD is blocked the same way
    // (invalidHostSuffixes). gmail.com is in hostAllowList (MX checks
    // skipped); the only extra rule is a >=6 char local part, which the
    // e2e-<stamp> name satisfies. No mailbox is ever read; confirmation
    // links go nowhere.
    await page.getByTestId("name-field").fill(`E2E ${stamp}`);
    await page
      .getByTestId("email-field")
      .or(page.locator('input[type="email"]'))
      .first()
      .fill(`e2e-${stamp}@gmail.com`);
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
