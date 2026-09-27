import { expect, test } from "@playwright/test";

/**
 * Phase 4 guarantee: a URL that names no resource answers with a REAL 404.
 *
 * The defect this pins down: `/auction/[id]` and `/profile/[username]` stream a
 * `loading.tsx` shell before the page can call `notFound()`, so the status is
 * committed at 200 before the not-found code ever runs. `src/proxy.ts` now
 * checks existence before streaming; these tests fail if that guard is removed,
 * loosened, or starts over-blocking (the "known route is still 200" case).
 */
test.describe("not found", () => {
  test("unknown auction id answers 404 with the auction not-found UI", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const response = await page.goto(
      "/auction/00000000-0000-4000-8000-000000000000"
    );
    expect(response?.status()).toBe(404);

    // The useful UI still renders (same component as notFound()), and it is
    // the AUCTION-specific one, not the root catch-all.
    const notFoundUi = page.getByTestId("empty-state");
    await expect(notFoundUi).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Auction not found" })
    ).toBeVisible();
    await expect(
      notFoundUi.getByText("was removed, or isn't visible")
    ).toBeVisible();

    // Missing content stays out of the index even on the 404 response — and
    // with no conflicting `index, follow` (that directive used to ride in from
    // the root layout; see layout.tsx). Duplicates of the SAME directive are
    // harmless and their count varies with streaming, so assert direction,
    // not multiplicity.
    await expect(
      page.locator('meta[name="robots"][content*="noindex"]')
    ).not.toHaveCount(0);
    await expect(
      page.locator('meta[name="robots"][content="index, follow"]')
    ).toHaveCount(0);

    // Navigation out of the dead end works. Scoped to the not-found UI: the
    // footer marketplace nav carries the same label.
    await page
      .getByTestId("empty-state")
      .getByRole("link", { name: "Browse auctions" })
      .click();
    await expect(page).toHaveURL(/\/browse$/);
    await expect(page.getByTestId("browse-filters")).toBeVisible({
      timeout: 30_000,
    });

    // No uncaught exceptions on the way (the 404 document itself is expected).
    expect(pageErrors).toEqual([]);
  });

  test("malformed auction id answers 404 without a not-a-uuid page", async ({
    page,
  }) => {
    const response = await page.goto("/auction/not-a-uuid");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Auction not found" })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("unknown profile answers 404 while existing routes still answer 200", async ({
    page,
  }) => {
    const missing = await page.goto(
      "/profile/definitely-not-a-real-user-xyz"
    );
    expect(missing?.status()).toBe(404);

    const browse = await page.goto("/browse");
    expect(browse?.status()).toBe(200);

    const home = await page.goto("/");
    expect(home?.status()).toBe(200);
  });
});
