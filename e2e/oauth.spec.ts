import { expect, test } from "@playwright/test";
import { waitForHydratedForm } from "./fixtures";

/**
 * Google OAuth initiation — and deliberately nothing further.
 *
 * Completing a Google sign-in needs a real Google account plus the Supabase
 * dashboard provider enabled, neither of which an automated suite may assume:
 * clicking through would either mint a real user or land on Supabase's
 * "provider is not enabled" error page. So these tests prove the handoff —
 * the button exists on both auth surfaces and hands a well-formed authorize
 * URL to the browser — and treat the disabled-provider error page as an
 * explicit skip (same honest-skip convention as the throttle skips in
 * auth.spec.ts), never as a pass and never as a failure.
 */
test.describe("google OAuth initiation", () => {
  test("login offers Continue with Google above password sign-in", async ({
    page,
  }) => {
    await page.goto("/login");
    await waitForHydratedForm(page, "login-form");

    const google = page.getByTestId("google-sign-in-button");
    await expect(google).toBeVisible();
    await expect(google).toHaveText(/continue with google/i);
    await expect(page.getByTestId("sign-in-button")).toBeVisible();
    await expect(page.getByTestId("otp-toggle-button")).toBeVisible();
  });

  test("signup offers Continue with Google above account creation", async ({
    page,
  }) => {
    await page.goto("/signup");
    await waitForHydratedForm(page, "signup-form");

    const google = page.getByTestId("google-sign-in-button");
    await expect(google).toBeVisible();
    await expect(google).toHaveText(/continue with google/i);
    await expect(page.getByTestId("sign-up-button")).toBeVisible();
  });

  for (const from of ["/login", "/signup"] as const) {
    test(`Google handoff from ${from} reaches Google or skips cleanly`, async ({
      page,
    }) => {
      await page.goto(from);
      await waitForHydratedForm(page, from === "/login" ? "login-form" : "signup-form");
      await page.getByTestId("google-sign-in-button").click();

      // Wait until the click observably does something: we leave BidBlitz
      // for Google, or the button reports it cannot start. Both app hosts
      // (custom domain and Vercel) count as "still here".
      const here = /bidblitz|bid-blitz|localhost|127\.0\.0\.1/;
      await expect
        .poll(
          async () => {
            const host = new URL(page.url()).hostname;
            if (!here.test(host)) return host;
            if ((await page.getByTestId("oauth-error").count()) > 0) return "oauth-error";
            return host;
          },
          { timeout: 45_000, intervals: [1_000] }
        )
        .not.toMatch(here);

      const host = new URL(page.url()).hostname;
      if (host === "accounts.google.com") return; // provider configured: handoff proven
      const body = ((await page.textContent("body")) ?? "").toLowerCase();
      if (/provider is not enabled|unsupported provider/.test(body)) {
        // Supabase's own authorize endpoint refusing: the dashboard step is
        // pending, so skip loudly instead of failing for an owner action.
        test.skip(true, "Google provider not enabled in the Supabase dashboard");
      }
      // Any other landing is a real defect: still on BidBlitz with no safe
      // error shown (poll above) yet neither Google nor the provider error.
      expect(host, `Google handoff from ${from} went nowhere recognisable`).toBe(
        "accounts.google.com"
      );
    });
  }
});
