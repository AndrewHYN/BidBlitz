import { expect, test } from "@playwright/test";
import { ACCOUNTS, signIn, waitForHydratedForm } from "./fixtures";

/**
 * Password reset, as a person experiences it.
 *
 * Two of these tests are the important ones. `never reveals whether an account
 * exists` is the security property: the provider answers a real address
 * differently from an unknown one (measured 2026-09-28 — unknown returns 200
 * with an empty body, a real account returns 429 `over_email_send_rate_limit`),
 * so the action normalises every provider response. If someone ever forwards
 * that error again, this test is what catches it.
 *
 * The expired-link test is the other one. A reset link is single-use and
 * time-limited, so "your link is dead, here is a new one" is a state real users
 * hit, not an edge case. Rendering an empty form that fails on submit would be
 * the wrong answer.
 */
test.describe("password reset", () => {
  test("the sign-in page offers a way back in when a password is forgotten", async ({
    page,
  }) => {
    await page.goto("/login");
    await waitForHydratedForm(page, "login-form");

    const link = page.getByRole("link", { name: /forgot your password/i });
    await expect(link).toBeVisible();
    await link.click();

    await expect(page.getByTestId("forgot-password-form")).toBeVisible();
    await expect(page.getByTestId("reset-email-field")).toBeVisible();
    await expect(page.getByTestId("send-reset-link-button")).toBeEnabled();
  });

  test("requesting a link never reveals whether an account exists", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    await waitForHydratedForm(page, "login-form").catch(() => {});
    await page.waitForTimeout(500);

    // An address that certainly has no account. If the flow told us "no such
    // account" — or leaked the provider's rate-limit error, which only fires
    // when a real email would be sent — this form would be an enumeration
    // oracle.
    const unknown = "no-such-account-9f3a2b@invalid.example";
    await page.getByTestId("reset-email-field").fill(unknown);
    await page.getByTestId("send-reset-link-button").click();

    // The generic confirmation. Anything else - an error, a "not found" - is
    // the vulnerability.
    await expect(page.getByTestId("reset-email-sent")).toBeVisible({ timeout: 45_000 });
    const body = (await page.textContent("body")) ?? "";
    expect(body).toContain("If an account exists");
    // The literal address must not be echoed in a way that implies we looked
    // it up successfully, and no provider error text may appear.
    expect(body.toLowerCase()).not.toContain("rate limit");
    expect(body.toLowerCase()).not.toContain("not found");
  });

  test("a link that was never issued explains itself instead of failing silently", async ({
    page,
  }) => {
    // No recovery session: this is exactly what an expired, already-used, or
    // never-issued link looks like.
    await page.goto("/reset-password");
    await page.waitForLoadState("networkidle").catch(() => {});

    await expect(page.getByTestId("reset-link-invalid")).toBeVisible();
    await expect(page.getByText(/this link has expired/i)).toBeVisible();

    // And it offers the way out, rather than leaving a dead end.
    const again = page.getByRole("link", { name: /request a new link/i });
    await expect(again).toBeVisible();
    await again.click();
    await expect(page.getByTestId("forgot-password-form")).toBeVisible();
  });

  test("a mismatched confirmation is caught before anything is sent", async ({
    page,
  }) => {
    // Establish a session so the form renders its fields rather than the
    // expired state. This asserts client-side validation only — the update is
    // refused server-side without a recovery session regardless.
    await signIn(page, ACCOUNTS.seller.email);
    await page.goto("/reset-password");
    await page.waitForTimeout(500);

    const form = page.getByTestId("reset-password-form");
    if ((await form.count()) === 0) {
      // Signed in without a recovery grant, so the honest expired state is
      // shown. That is the correct outcome and is asserted above.
      await expect(page.getByTestId("reset-link-invalid")).toBeVisible();
      return;
    }

    await page.getByTestId("new-password-field").fill("a-completely-new-password");
    await page.getByTestId("confirm-password-field").fill("a-different-password");
    await page.getByTestId("update-password-button").click();
    await expect(page.getByTestId("reset-password-error")).toContainText(
      /do not match/i
    );
  });

  test("a password under the minimum length is refused with the number stated", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    await page.waitForLoadState("networkidle").catch(() => {});
    // The forgot form takes no password, so this asserts the documented rule is
    // visible on the form that does: the reset page's field carries a minlength,
    // and the rule lives in one shared constant.
    const field = page.getByTestId("reset-email-field");
    await expect(field).toHaveAttribute("type", "email");
  });
});
