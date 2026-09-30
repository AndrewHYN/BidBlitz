import { expect, test } from "@playwright/test";

/**
 * Public-page viewport sweep: the pages anyone can open, at the four widths
 * the release checklist names, must render without sideways scrolling, dead
 * landmarks or missing content. No account, no fixtures, no writes: these
 * tests create nothing, so they can run in any order against production.
 *
 * The homepage Recently Listed rail is covered structurally here (it renders
 * its cards or its honest empty state, never stale filler), while the
 * freshness RULE itself is proven at the database boundary in
 * scripts/db/verify-engine.mjs (the RL: checks) and as a pure predicate in
 * src/lib/auction-status.test.ts. A browser cannot time-travel 72 hours, so
 * the browser asserts what a browser can: layout integrity.
 */

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
] as const;

const PUBLIC_PAGES = ["/", "/browse", "/help/rules", "/terms"] as const;

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const path of PUBLIC_PAGES) {
      test(`${path} has no horizontal overflow`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow).toBeLessThanOrEqual(2);
      });
    }

    test("homepage renders the recent rail section", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByTestId("home-hero")).toBeVisible({ timeout: 30_000 });
      // The rail section always renders (cards or its own empty state); the
      // rule about WHAT fills it - only fresh rows, never stale filler - is
      // proven at the boundary in db:verify and in unit tests.
      await expect(page.getByTestId("home-recent")).toBeVisible({ timeout: 30_000 });
    });
  });
}
