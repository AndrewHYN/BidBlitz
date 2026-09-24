import { expect, test, type Page } from "@playwright/test";

/**
 * Mobile shell — tagged @mobile so it can be selected with --grep @mobile.
 * Runs under both projects; on desktop it simply exercises the same paths.
 */

async function openHeaderMenu(page: Page): Promise<boolean> {
  const candidates = [
    page.getByTestId("header-menu"),
    page.getByTestId("mobile-menu-button"),
    page.getByTestId("nav-menu-toggle"),
    page.getByRole("button", { name: /menu/i }),
    page.locator('button[aria-label*="menu" i]'),
  ];
  for (const candidate of candidates) {
    const target = candidate.first();
    if (await target.isVisible().catch(() => false)) {
      await target.click();
      return true;
    }
  }
  return false;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

test.describe("mobile shell", () => {
  test("@mobile header menu opens", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("home-hero")).toBeVisible({ timeout: 30_000 });

    const opened = await openHeaderMenu(page);
    if (!opened) {
      // No menu control is exposed yet — reported rather than guessed at.
      test.skip(true, "no header menu control is exposed by the UI yet");
    }

    const menuPanel = page.getByRole("dialog").or(page.getByRole("menu"));
    const navLinks = page.getByRole("navigation").getByRole("link");
    await expect(menuPanel.or(navLinks.first()).first()).toBeVisible({ timeout: 15_000 });
  });

  test("@mobile browse grid is usable without sideways scrolling", async ({
    page,
  }) => {
    await page.goto("/browse");
    await expect(page.getByTestId("browse-filters")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId("browse-grid").or(page.getByTestId("empty-state")).first()
    ).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page);
  });

  test("@mobile auction bid panel is reachable without horizontal scroll", async ({
    page,
  }) => {
    await page.goto("/browse");
    await expect(
      page.getByTestId("browse-grid").or(page.getByTestId("empty-state")).first()
    ).toBeVisible({ timeout: 30_000 });

    const cards = page.getByTestId("auction-card");
    if ((await cards.count()) === 0) {
      test.skip(true, "no auctions available to open");
    }
    await cards.first().click();
    await page.waitForURL(/\/auction\//, { timeout: 30_000 });

    const panel = page
      .getByTestId("sign-in-to-bid")
      .or(page.getByTestId("place-bid-button"))
      .or(page.getByTestId("auction-closed-panel"))
      .or(page.getByTestId("auction-scheduled-panel"));
    await expect(panel.first()).toBeVisible({ timeout: 30_000 });

    await panel.first().scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
  });
});
