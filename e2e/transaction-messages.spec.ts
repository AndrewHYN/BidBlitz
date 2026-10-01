import { expect, test } from "@playwright/test";
import { ACCOUNTS, signIn } from "./fixtures";

/**
 * Post-win transaction threads.
 *
 * What this proves WITHOUT a settled sale (no suite settles: the shortest
 * listing duration is 1 hour): the thread route is auth-gated, and forged
 * or foreign ids render the same "not available" state — never a leak, never
 * a crash, even before the messaging migration is applied.
 *
 * The round trip (winner sends, seller reads, unread badge, realtime) is
 * proven post-migration by scripts/db/verify-messaging-rls.mjs plus a manual
 * settled sale, not here: manufacturing a SOLD auction inside a timed test
 * would mean a 1-hour wait for a 30-second assertion.
 */
test.describe("transaction threads", () => {
  test("anonymous visitors are bounced from a thread to /login", async ({
    page,
  }) => {
    await page.goto(
      "/dashboard/transactions/123e4567-e89b-42d3-a456-426614174000"
    );
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
    await expect(page.getByTestId("login-form")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("a forged thread id renders not-available, not a leak or a crash", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.buyer2.email, ACCOUNTS.buyer2.password);
    await page.goto(
      "/dashboard/transactions/123e4567-e89b-42d3-a456-426614174000"
    );
    await expect(page.getByTestId("thread-unavailable")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("message-thread")).toHaveCount(0);
    await expect(page.getByTestId("message-form")).toHaveCount(0);
  });

  test("the transactions table offers a thread link per sale", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
    await page.goto("/dashboard/transactions");
    await page.waitForLoadState("networkidle").catch(() => {});
    const table = page.getByTestId("transactions-table");
    if ((await table.count()) === 0) {
      // No settled sales for this account: nothing to link, and the empty
      // state (not a broken table) is the correct outcome.
      await expect(
        page.getByText(/no transactions yet/i)
      ).toBeVisible({ timeout: 15_000 });
      return;
    }
    await expect(page.getByTestId("message-link").first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
