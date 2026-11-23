import { expect, test } from "@playwright/test";

/**
 * Public viewport sweep: verify actual current marketplace landmarks and
 * horizontal layout integrity across phone, tablet, and desktop sizes.
 * This suite is read-only and does not depend on inventory being present.
 */

const VIEWPORTS = [
  { name: "320", width: 320, height: 640 },
  { name: "360", width: 360, height: 740 },
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
] as const;

const PUBLIC_PAGES = ["/", "/browse", "/help/rules", "/terms"] as const;

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const path of PUBLIC_PAGES) {
      test(`${path} has no horizontal overflow`, async ({ page }) => {
        // Next pages may continue background requests after hydration; waiting
        // for networkidle can stall for 30s without improving layout coverage.
        // page.goto waits for the load event, so CSS and SSR markup are ready.
        await page.goto(path);
        await expect(page.locator("body")).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow).toBeLessThanOrEqual(2);
      });
    }

    test("homepage renders its current listing and discovery landmarks", async ({ page }) => {
      await page.goto("/");
      // The former 'home-recent' rail no longer exists; current home renders
      // a latest-listings section and a data-backed discovery section instead.
      // Restrict to main to avoid matching preloaded/duplicate route content.
      const main = page.locator("main#main");
      await expect(main.locator("#latest-listings").first()).toBeVisible();
      await expect(main.getByTestId("home-discovery").first()).toBeVisible();
    });
  });
}
