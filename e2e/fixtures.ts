import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Test accounts — provisioned and email-confirmed in the live Supabase
 * project. Never assert anything payment-related against these; the payment
 * provider is intentionally not configured.
 */
export const TEST_PASSWORD = "Bl1tzVerify!2026";

export const ACCOUNTS = {
  seller: { email: "seller@bidblitz.test", password: TEST_PASSWORD },
  buyer1: { email: "buyer1@bidblitz.test", password: TEST_PASSWORD },
  buyer2: { email: "buyer2@bidblitz.test", password: TEST_PASSWORD },
  buyer3: { email: "buyer3@bidblitz.test", password: TEST_PASSWORD },
} as const;

/** A valid 1x1 PNG — enough to satisfy the "at least one image" gate. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** Timestamped, unique, and always within the 3..120 char title bounds. */
export function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sign in via /login and wait for the navigation away from /login that a
 * successful sign-in performs. Cookies are cleared first so a previously
 * signed-in visitor cannot be bounced away from the form by a redirect.
 */
export async function signIn(
  page: Page,
  email: string,
  password: string = TEST_PASSWORD
): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");

  await expect(
    page.getByTestId("login-form").or(page.getByTestId("email-field"))
  ).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("email-field").fill(email);
  await page.getByTestId("password-field").fill(password);
  await page.getByTestId("sign-in-button").click();

  await expect(page).toHaveURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 45_000,
  });
}

/**
 * Choose a value in a select-like field. Handles native <select>, radio
 * groups, and ARIA listbox/menu widgets (the field may be either).
 */
async function chooseOption(
  page: Page,
  testId: string,
  prefer?: RegExp
): Promise<void> {
  const field = page.getByTestId(testId);
  await field.waitFor({ state: "visible", timeout: 30_000 });

  const tag = await field.evaluate((el) => el.tagName).catch(() => "DIV");

  if (tag === "SELECT") {
    const options = await field.locator("option").evaluateAll((els) =>
      els.map((el, index) => {
        const option = el as HTMLOptionElement;
        return {
          index,
          text: (option.textContent ?? "").trim(),
          value: option.value,
        };
      })
    );
    const usable = options.filter(
      (option) => option.value !== "" && !/select|choose|pick/i.test(option.text)
    );
    const chosen =
      (prefer ? usable.find((option) => prefer.test(option.text)) : undefined) ??
      usable[0] ??
      options[0];
    if (chosen) await field.selectOption({ index: chosen.index });
    return;
  }

  const radios = field.getByRole("radio");
  if ((await radios.count()) > 0) {
    const preferred = prefer ? field.getByRole("radio", { name: prefer }) : radios;
    const target = (await preferred.count()) > 0 ? preferred.first() : radios.first();
    await target.check();
    return;
  }

  // Custom widget: open it, then pick an option from whatever it reveals.
  await field.click();
  const candidates: Locator[] = [
    prefer ? page.getByRole("option", { name: prefer }) : page.getByRole("option").first(),
    prefer
      ? page.getByRole("menuitem", { name: prefer })
      : page.getByRole("menuitem").first(),
    page.locator('[role="listbox"] li').first(),
  ];
  for (const candidate of candidates) {
    if (await candidate.first().isVisible().catch(() => false)) {
      await candidate.first().click();
      return;
    }
  }
  throw new Error(`Could not choose an option for testid "${testId}"`);
}

export type CreateListingOptions = {
  titlePrefix?: string;
  startingBid?: string;
  increment?: string;
  /** Stop once the draft exists on /sell/[id] (default publishes it). */
  publish?: boolean;
};

/**
 * Seller flow: /sell form -> draft at /sell/[id] -> (optionally) attach an
 * image if publishing requires one -> publish. Returns the auction id (the
 * draft id and the auction id are the same value).
 */
export async function createListing(
  page: Page,
  opts: CreateListingOptions = {}
): Promise<string> {
  const title = uniqueTitle(opts.titlePrefix ?? "E2E listing");

  await page.goto("/sell");
  await expect(page.getByTestId("sell-form")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("sell-title").fill(title);
  await page
    .getByTestId("sell-description")
    .fill("Listed by the BidBlitz end-to-end suite for transaction verification.");
  await chooseOption(page, "sell-category");
  await chooseOption(page, "sell-condition", /good/i);
  await page.getByTestId("sell-location").fill("Berlin");
  await page.getByTestId("sell-starting-bid").fill(opts.startingBid ?? "10");
  await page.getByTestId("sell-increment").fill(opts.increment ?? "1");
  // DURATIONS are ordered shortest first, so preferring "1 hour" (or the
  // first usable option) always picks the shortest available duration.
  await chooseOption(page, "sell-duration", /1 hour/i);

  await page.getByTestId("sell-submit").click();
  await page.waitForURL(/\/sell\/[0-9a-f-]+/i, { timeout: 45_000 });

  const id = page.url().split("/sell/")[1]?.split(/[?#]/)[0] ?? "";
  expect(id).not.toBe("");

  if (opts.publish === false) return id;

  const upload = page.getByTestId("upload-input");
  const publish = page.getByTestId("publish-button");
  await expect(publish).toBeVisible({ timeout: 30_000 });

  let blocked = await publish.isDisabled();
  if (!blocked) {
    blocked = await page.getByTestId("publish-disabled-reason").isVisible();
  }

  if (blocked && (await upload.count()) > 0) {
    await upload.setInputFiles({
      name: "listing.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    await expect(publish).toBeEnabled({ timeout: 60_000 });
  }

  await publish.click();
  await page.waitForURL(/\/auction\//, { timeout: 15_000 }).catch(() => undefined);

  // Fallback: publishing demanded an image the disabled-state did not
  // advertise — attach one and retry once.
  if (!page.url().includes("/auction/") && (await upload.count()) > 0) {
    const errored = await page.getByTestId("sell-field-error").isVisible();
    if (errored) {
      await upload.setInputFiles({
        name: "listing.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });
      await page.waitForTimeout(1_500);
      await publish.click().catch(() => undefined);
      await page.waitForURL(/\/auction\//, { timeout: 30_000 }).catch(() => undefined);
    }
  }

  return id;
}
