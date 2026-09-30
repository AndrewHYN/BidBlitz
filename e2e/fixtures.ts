import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Test accounts — provisioned and email-confirmed in the live Supabase
 * project. Never assert anything payment-related against these; the payment
 * provider is intentionally not configured.
 */
export const TEST_PASSWORD = "Bl1tzVerify!2026";

/**
 * `username` is stated rather than derived, so a spec that needs a profile URL
 * does not silently rebuild it from the email. These are the values the
 * provisioning used; the auth trigger takes the local part of the email.
 */
export const ACCOUNTS = {
  seller: { email: "seller@bidblitz.test", username: "seller", password: TEST_PASSWORD },
  buyer1: { email: "buyer1@bidblitz.test", username: "buyer1", password: TEST_PASSWORD },
  buyer2: { email: "buyer2@bidblitz.test", username: "buyer2", password: TEST_PASSWORD },
  buyer3: { email: "buyer3@bidblitz.test", username: "buyer3", password: TEST_PASSWORD },
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
/**
 * Wait until a form's React has taken over, then assert it is on screen.
 *
 * Why this exists. The sign-in and sign-up forms declare `method="post"` on
 * purpose: before hydration a submit is a native browser submit, and without
 * that attribute a native submit would be a GET that appends the email and the
 * PASSWORD to the URL (see src/components/form-method.test.ts). Declaring POST
 * makes an un-hydrated submit a safe failure instead of a credential leak.
 *
 * A person never notices, because typing an email and a password takes far
 * longer than the bundle takes to load. A test can: `toBeVisible()` returns as
 * soon as the server-rendered HTML is on screen, which is *before* hydration,
 * so an automated submit could beat it and observe nothing happening. That
 * surfaced as an intermittent failure in `auth.spec.ts` and read like a product
 * bug when it was a test-side race.
 *
 * `data-hydrated` states the real fact — the client is live — so the test waits
 * for the same thing a person naturally waits for. No retry, no sleep, and no
 * weakened assertion.
 */
export async function waitForHydratedForm(
  page: Page,
  testId: "login-form" | "signup-form"
): Promise<void> {
  // Scoped to #main: under full-suite load the login page was observed
  // streaming the form twice (one hydrated node inside #main, one unhydrated
  // shell outside it), and the unscoped assertion tripped strict mode on the
  // duplicate. The hydrated form a person actually uses is the one in #main.
  const form = page.locator("#main").getByTestId(testId);
  await expect(form).toBeVisible({ timeout: 30_000 });
  await expect(form).toHaveAttribute("data-hydrated", "true", { timeout: 30_000 });
}

export async function signIn(
  page: Page,
  email: string,
  password: string = TEST_PASSWORD
): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");

  // `.first()` matters: `login-form` CONTAINS `email-field`, so the union
  // matches two nodes and Playwright's strict mode rejects the whole assertion.
  await expect(
    page.getByTestId("login-form").or(page.getByTestId("email-field")).first()
  ).toBeVisible({ timeout: 30_000 });
  await waitForHydratedForm(page, "login-form");
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
 *
 * Review routing: the seller's first-ever publish (and any high-value or
 * flagged one) is held as PENDING_REVIEW instead of going live, and no test
 * holds admin credentials to approve it. When that happens the helper lists
 * a second auction — the held first listing counts as non-draft history, so
 * the second publish goes live deterministically — and returns the LIVE id.
 * The held listing keeps its fixture title and is removed by the teardown
 * sweeper like every other fixture. Bounded to one retry: a second hold
 * means something real is wrong and the test must fail honestly.
 */
export async function createListing(
  page: Page,
  opts: CreateListingOptions = {},
  attempt = 1
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
  // Publishing locks the terms irreversibly, so it asks once first.
  const confirm = page.getByTestId("publish-confirm");
  await expect(confirm).toBeVisible({ timeout: 5_000 });
  await confirm.click();

  // Success is the launched panel (countdown + share controls) — the page
  // deliberately stays at /sell/[id], so there is no URL to wait for.
  const success = page.getByTestId("publish-success");
  try {
    await expect(success).toBeVisible({ timeout: 30_000 });
  } catch {
    // One bounded recovery: the server re-checked the image gate after the
    // upload (or the dialog surfaced an error). Close it, attach one photo
    // and retry exactly once — a second failure fails the test honestly.
    const cancel = page.getByRole("button", { name: /not yet/i });
    if (await cancel.isVisible().catch(() => false)) await cancel.click();
    if ((await upload.count()) > 0) {
      await upload.setInputFiles({
        name: "listing.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });
      await page.waitForTimeout(1_500);
      await publish.click();
      await expect(confirm).toBeVisible({ timeout: 5_000 });
      await confirm.click();
      await expect(success).toBeVisible({ timeout: 30_000 });
    }
  }

  // Held for review rather than launched: the seller's first publish lands in
  // PENDING_REVIEW by design, and nothing in the suite can approve it. The
  // verdict is read from a reloaded /sell/[id] - stable server-rendered state
  // - never from the just-clicked panel, whose client state can lag the
  // server by a render. A held listing counts as non-draft history, so the
  // second publish goes live; the held row keeps its fixture title, so the
  // teardown sweeper removes it with the rest. Bounded to one retry: a
  // second hold fails fast here with a named cause instead of timing out
  // five minutes later on a buyer's 404.
  await page.reload();
  await expect(page.getByTestId("sell-form").or(page.getByTestId("publish-button")).or(page.getByTestId("publish-success")).first()).toBeVisible({ timeout: 30_000 });
  if ((await page.getByText("Under review").count()) > 0) {
    if (attempt >= 2) {
      throw new Error(
        `createListing: second publish still held for review (auction ${id}); refusing to hand back an id buyers cannot see`
      );
    }
    return createListing(page, opts, attempt + 1);
  }

  return id;
}
