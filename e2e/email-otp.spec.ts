import { expect, test } from "@playwright/test";
import { ACCOUNTS, waitForHydratedForm } from "./fixtures";

/**
 * Passwordless email-OTP login, secondary to passwords.
 *
 * Nothing here creates an account: the request view only asks GoTrue to mail
 * a code to an address, and the wrong-code path never needs that mail to
 * arrive (the provider answers "incorrect" without consulting the inbox).
 * Full code-receipt verification needs a controlled inbox and is therefore a
 * manual release step, not an automated one.
 */
test.describe("email OTP login", () => {
  test("the login form offers a secondary sign-in code action", async ({ page }) => {
    await page.goto("/login");
    await waitForHydratedForm(page, "login-form");

    // Password login stays primary: the OTP control is a secondary outline
    // button below the primary submit, after an OR separator.
    await expect(page.getByTestId("sign-in-button")).toBeVisible();
    const toggle = page.getByTestId("otp-toggle-button");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText(/email me a sign-in code/i);

    await toggle.click();
    await expect(page.getByTestId("send-code-button")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("otp-back-button")).toBeVisible();
  });

  test("requesting a code carries the typed email into the code step", async ({ page }) => {
    await page.goto("/login");
    await waitForHydratedForm(page, "login-form");

    await page.getByTestId("email-field").fill(ACCOUNTS.buyer1.email);
    await page.getByTestId("otp-toggle-button").click();
    await expect(page.getByTestId("send-code-button")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("send-code-button").click();
    const codeField = page.getByTestId("otp-code-field");
    await expect(codeField).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("verify-code-button")).toBeVisible();
    await expect(page.getByTestId("otp-sent-message")).toBeVisible();
  });

  test("an incorrect code fails honestly without signing in", async ({ page }) => {
    await page.goto("/login");
    await waitForHydratedForm(page, "login-form");

    await page.getByTestId("email-field").fill(ACCOUNTS.buyer1.email);
    await page.getByTestId("otp-toggle-button").click();
    await expect(page.getByTestId("send-code-button")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("send-code-button").click();
    const codeField = page.getByTestId("otp-code-field");
    await expect(codeField).toBeVisible({ timeout: 45_000 });

    // 000000 is overwhelmingly likely to be wrong (live GoTrue answers it
    // with "Token has expired or is invalid"); if the provider ever accepts
    // it, the dashboard assertion below fails loudly instead of silently
    // passing as someone else's session.
    await codeField.fill("000000");
    await page.getByTestId("verify-code-button").click();

    await expect(page.getByTestId("auth-error")).toContainText(/didn't work/i, { timeout: 45_000 });
    await expect(page).toHaveURL(/\/login/);
    await expect(page).not.toHaveURL(/\/dashboard/);
  });
});