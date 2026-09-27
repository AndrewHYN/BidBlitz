import { expect, test } from "@playwright/test";

/**
 * Phase 4 guarantee: a URL that names no resource answers with a REAL 404.
 *
 * The defect this pins down: `/auction/[id]` and `/profile/[username]` stream a
 * `loading.tsx` shell before the page can call `notFound()`, so the status is
 * committed at 200 before the not-found code ever runs â€” and no page-level
 * workaround escapes it (a synchronous `notFound()` in a dedicated route still
 * answers 200 under the root loading boundary; measured). `src/proxy.ts`
 * therefore detects the missing resource BEFORE streaming and rewrites it onto
 * Next's router-level not-found path, carrying `x-bidblitz-missing` so the root
 * layout can emit the resource-specific title and an explicit `noindex`.
 *
 * These tests run against the production build (`next start`) locally, but
 * every assertion here was also verified against the deployed Vercel URL â€”
 * the rewrite-to-unmatched mechanism was chosen precisely because
 * `next({ status: 404 })` behaved differently on the two platforms.
 */
test.describe("not found", () => {
  test("unknown auction id answers 404 with a noindexed not-found page", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const response = await page.goto(
      "/auction/00000000-0000-4000-8000-000000000000"
    );
    expect(response?.status()).toBe(404);

    // The browser keeps the original URL (internal rewrite, not a redirect).
    expect(new URL(page.url()).pathname).toBe(
      "/auction/00000000-0000-4000-8000-000000000000"
    );

    // The useful not-found UI renders â€” the root one, inside the site chrome.
    const notFoundUi = page.getByTestId("not-found-page");
    await expect(notFoundUi).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "This page went unsold" })
    ).toBeVisible();

    // Missing content stays out of the index: a document-level meta directive
    // (from root generateMetadata) AND the X-Robots-Tag response header, with
    // no conflicting `index, follow` anywhere in the head.
    await expect(
      page.locator('meta[name="robots"][content*="noindex"]')
    ).not.toHaveCount(0);
    await expect(
      page.locator('meta[name="robots"][content="index, follow"]')
    ).toHaveCount(0);
    expect(response?.headers()["x-robots-tag"] ?? "").toContain("noindex");

    // The title is the resource-specific one from root generateMetadata, not
    // the root default.
    await expect(page).toHaveTitle(/Auction not found/);

    // Navigation out of the dead end works. Scoped to the not-found UI: the
    // footer marketplace nav carries the same label.
    await notFoundUi.getByRole("link", { name: "Browse auctions" }).click();
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
    await expect(page.getByTestId("not-found-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveTitle(/Auction not found/);
  });

  test("unknown profile answers 404 while existing routes still answer 200", async ({
    page,
  }) => {
    const missing = await page.goto(
      "/profile/definitely-not-a-real-user-xyz"
    );
    expect(missing?.status()).toBe(404);
    await expect(page).toHaveTitle(/Profile not found/);
    expect(missing?.headers()["x-robots-tag"] ?? "").toContain("noindex");

    const browse = await page.goto("/browse");
    expect(browse?.status()).toBe(200);

    const home = await page.goto("/");
    expect(home?.status()).toBe(200);
  });
});
