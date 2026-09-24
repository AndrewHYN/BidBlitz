import { expect, test } from "@playwright/test";
import { ACCOUNTS, createListing, signIn } from "./fixtures";

const PROTECTED_PATHS = [
  "/dashboard",
  "/dashboard/transactions",
  "/notifications",
  "/settings",
];

test.describe("security", () => {
  test("anonymous visitors are bounced from account pages to /login", async ({
    page,
  }) => {
    for (const path of PROTECTED_PATHS) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
      await expect(page.getByTestId("login-form")).toBeVisible({ timeout: 30_000 });
    }
  });

  test("a buyer gets 404 / not-found for another seller's /sell/[id]", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    // Seller creates a draft so a real /sell/[id] URL exists.
    await signIn(page, ACCOUNTS.seller.email, ACCOUNTS.seller.password);
    const auctionId = await createListing(page, {
      titlePrefix: "RLS",
      publish: false,
    });

    // A different, signed-in user asks for the seller-only page.
    await signIn(page, ACCOUNTS.buyer1.email);
    const response = await page.goto(`/sell/${auctionId}`, {
      waitUntil: "domcontentloaded",
    });

    if (response && response.status() === 404) {
      expect(response.status()).toBe(404);
    } else {
      await expect(page.getByTestId("not-found-page")).toBeVisible({
        timeout: 30_000,
      });
    }
  });
});
