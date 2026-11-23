import { expect, test, type Page } from "@playwright/test";

/**
 * Regression for the 2026-11-23 off-screen offer sheet on Android.
 * Tailwind v4's individual CSS `translate` property must be reset when
 * the standard centered dialog is restyled as a bottom sheet. Checking only
 * document.scrollWidth misses fixed dialogs shifted beyond the viewport.
 *
 * Read-only: opens a public listing and the composer but never submits it.
 */
const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

async function expectDialogInsideViewport(page: Page, kind: "SALE" | "SERVICE") {
  const selector = kind === "SALE" ? "sale-offer-sheet" : "service-request-sheet";
  const dialog = page.getByTestId(selector);
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("deal-sheet-form")).toBeVisible();

  const bounds = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      translate: styles.translate,
      position: styles.position,
    };
  });

  expect(bounds.position).toBe("fixed");
  expect(bounds.translate, "the dialog must not inherit Tailwind's centered translation").toBe("none");
  expect(bounds.left, "dialog clipped on the left").toBeGreaterThanOrEqual(-2);
  expect(bounds.top, "dialog clipped above the viewport").toBeGreaterThanOrEqual(-2);
  expect(bounds.right, "dialog clipped on the right").toBeLessThanOrEqual(bounds.viewportWidth + 2);
  expect(bounds.bottom, "dialog clipped below the viewport").toBeLessThanOrEqual(bounds.viewportHeight + 2);
  expect(bounds.width, "dialog too narrow to be usable").toBeGreaterThanOrEqual(
    Math.min(bounds.viewportWidth, 280)
  );
  expect(bounds.height).toBeGreaterThan(100);

  const footerButton = dialog.getByRole("button", {
    name: kind === "SALE" ? /send offer|sign in to continue/i : /send service request|sign in to continue/i,
  });
  await expect(footerButton).toBeInViewport({ ratio: 1 });

  if (bounds.viewportWidth < 640) {
    expect(
      Math.abs(bounds.bottom - bounds.viewportHeight),
      "mobile sheet should stay anchored to the bottom"
    ).toBeLessThanOrEqual(2);
  } else {
    expect(
      Math.abs((bounds.left + bounds.right) / 2 - bounds.viewportWidth / 2),
      "desktop dialog should be horizontally centered"
    ).toBeLessThanOrEqual(3);
  }

  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(documentOverflow, "document should not scroll sideways").toBeLessThanOrEqual(2);
}

for (const kind of ["SALE", "SERVICE"] as const) {
  test(`${kind.toLowerCase()} composer is completely visible on phone, tablet and desktop`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/browse?kind=${kind}`);
    const cards = page.getByTestId("auction-card");

    if ((await cards.count()) === 0) {
      test.skip(true, `No public ${kind.toLowerCase()} listing available; do not create test listings`);
    }
    const listingUrl = await cards.first().getAttribute("href");
    expect(listingUrl?.startsWith("/listing/")).toBe(true);
    await page.goto(listingUrl!);

    const trigger = page.getByTestId("listing-deal-trigger");
    await expect(trigger).toBeVisible();
    await trigger.click();

    for (const size of VIEWPORTS) {
      await page.setViewportSize(size);
      await expectDialogInsideViewport(page, kind);
    }

    const sheet = page.getByTestId(kind === "SALE" ? "sale-offer-sheet" : "service-request-sheet");
    if (kind === "SALE") {
      await expect(sheet.getByTestId("sale-offer-options")).toBeVisible();
    } else {
      await expect(sheet.getByTestId("service-request-fields")).toBeVisible();
    }

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
