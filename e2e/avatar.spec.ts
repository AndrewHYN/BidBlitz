import { expect, test } from "@playwright/test";
import { ACCOUNTS, signIn, TINY_PNG } from "./fixtures";

/**
 * Profile picture, as a person experiences it.
 *
 * What this file guards is the UI contract around the uploader: that a profile
 * with no picture is a normal, supported state that still looks like a person;
 * that the same person gets the same two letters in every surface; and that the
 * refusals a user hits name the fix instead of saying "error".
 *
 * The authorization model underneath is proved where it can be proved exactly â€”
 * `scripts/db/verify-engine.mjs` Â§ "avatars" drives the real Storage and REST
 * APIs with real user sessions and asserts that user A cannot write into user B's
 * folder, cannot escape it by traversal, cannot delete B's object, and cannot
 * point their profile at B's key or at an arbitrary string. Re-deriving that
 * through a browser would prove less, more slowly.
 */

test.describe("avatar", () => {
  test("a profile with no picture shows initials and offers a way to add one", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.seller.email);
    await page.goto("/settings");

    await expect(page.getByTestId("avatar-upload-button")).toBeVisible();
    await expect(
      page.getByText("Without a picture, we show your initials.")
    ).toBeVisible();

    // No "Remove" control, because there is nothing to remove. A button that
    // cannot do anything is a dead control, not a courtesy.
    await expect(page.getByTestId("avatar-remove-button")).toHaveCount(0);

    // The visible control is a real button with a real accessible name, so it
    // is reachable by keyboard and announced correctly.
    const upload = page.getByTestId("avatar-upload-button");
    await expect(upload).toBeEnabled();
    await expect(upload).toHaveAccessibleName(/upload a picture/i);

    // ...and the file input it opens is a native one, for screen readers.
    await expect(page.getByTestId("avatar-file-input")).toHaveAttribute(
      "type",
      "file"
    );
  });

  test("the initials fallback is the same on settings and on the profile page", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.seller.email);
    await page.goto("/settings");

    const onSettings = (
      await page
        .getByTestId("avatar-upload-button")
        .locator("xpath=ancestor::section")
        .getByTestId("user-avatar")
        .locator("span")
        .first()
        .innerText()
    ).trim();

    // Never blank: an empty circle reads as a broken image. Never longer than
    // two characters: that would overflow a 32px avatar.
    expect(onSettings.length).toBeGreaterThan(0);
    expect(onSettings.length).toBeLessThanOrEqual(2);

    await page.goto(`/profile/${ACCOUNTS.seller.username}`);
    const onProfile = (
      await page
        .getByTestId("profile-header")
        .getByTestId("user-avatar")
        .locator("span")
        .first()
        .innerText()
    ).trim();

    // The same person must look the same everywhere. A fallback that changed
    // between the settings page and the public profile reads as a bug.
    expect(onProfile).toBe(onSettings);
  });

  test("no avatar image is ever loaded from a host the user chose", async ({
    page,
  }) => {
    // The old schema let a user store any string in an `avatar_url` column that
    // was rendered straight into `<img src>`. With that column gone this can
    // only be asserted structurally, so it is asserted over every image on the
    // page: nothing off-origin may be requested.
    await signIn(page, ACCOUNTS.seller.email);
    await page.goto("/settings");

    const offOrigin = await page.evaluate(() =>
      [...document.querySelectorAll("img")]
        .map((img) => img.currentSrc || img.src)
        .filter((src) => src && /^https?:/.test(src))
        .filter((src) => {
          try {
            return new URL(src).origin !== location.origin;
          } catch {
            return false;
          }
        })
    );
    expect(offOrigin).toEqual([]);
  });

  test("an oversized file is refused before it is uploaded", async ({ page }) => {
    await signIn(page, ACCOUNTS.seller.email);
    await page.goto("/settings");

    // Just over 2 MB, so it is refused on SIZE, not on type. Padding with zeros
    // after a valid PNG header keeps the type check satisfied, which proves the
    // size check is the one that fired.
    await page.getByTestId("avatar-file-input").setInputFiles({
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.concat([TINY_PNG, Buffer.alloc(2 * 1024 * 1024)]),
    });

    await expect(page.getByTestId("avatar-error")).toBeVisible();
    await expect(page.getByTestId("avatar-error")).toContainText(/2 MB/);
    // Nothing was written, so the control is still offering to upload.
    await expect(page.getByTestId("avatar-upload-button")).toBeEnabled();
    await expect(page.getByTestId("avatar-remove-button")).toHaveCount(0);
  });

  test("a file that is not an image is refused, with the formats named", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.seller.email);
    await page.goto("/settings");

    // Lying about both the extension and the MIME type: the server decides from
    // the bytes, so neither of these is believed.
    await page.getByTestId("avatar-file-input").setInputFiles({
      name: "totally-a-photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("this is definitely not a picture", "utf8"),
    });

    await expect(page.getByTestId("avatar-error")).toBeVisible();
    await expect(page.getByTestId("avatar-error")).toContainText(
      /JPEG, PNG, WebP or GIF/i
    );
    await expect(page.getByTestId("avatar-remove-button")).toHaveCount(0);
  });

  test("an SVG is refused even though it is a real image format", async ({
    page,
  }) => {
    // SVG is an XML document that can carry script. Serving one from our own
    // origin would be a stored-XSS vector, so it is not in the allow-list at
    // all â€” not "allowed but sanitised", simply absent.
    await signIn(page, ACCOUNTS.seller.email);
    await page.goto("/settings");

    await page.getByTestId("avatar-file-input").setInputFiles({
      name: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
        "utf8"
      ),
    });

    await expect(page.getByTestId("avatar-error")).toBeVisible();
    await expect(page.getByTestId("avatar-error")).toContainText(
      /JPEG, PNG, WebP or GIF/i
    );
  });

  test("a profile page renders for a member with no listings and no picture", async ({
    page,
  }) => {
    // The two independent "nothing here yet" states must not turn into a 404,
    // a blank region or a broken image.
    await page.goto(`/profile/${ACCOUNTS.seller.username}`);
    await expect(page.getByTestId("profile-header")).toBeVisible();
    await expect(page.getByTestId("profile-display-name")).toBeVisible();
    await expect(page.getByTestId("user-avatar").first()).toBeVisible();
    await expect(page.getByTestId("profile-listings")).toBeVisible();
  });
});

/**
 * The two avatar states are mutually exclusive, proven in a real browser.
 *
 * ## The defect
 *
 * A real photograph and the fallback initials rendered at the same time, in the
 * same frame, stacked on each other. `UserAvatar` used `next/image` rather than
 * Radix's `AvatarImage` â€” deliberately, because a plain `<img src>` made the
 * header download the original upload â€” but Radix's `status` is only ever moved
 * by `AvatarImage`. It stayed `"loading"` forever, so `AvatarFallback` rendered
 * unconditionally, and `showImage ? <Image/> : null` guarded nothing.
 *
 * ## Why this needed a browser
 *
 * Every other signal was green while this was broken. The component typechecked,
 * linted, rendered a correct-looking frame, and 263 unit tests and 136 database
 * checks all passed. The unit-level tripwire in
 * `src/components/profile/user-avatar.test.ts` holds the shape, but only a real
 * render can prove that exactly one node is in the DOM and that the initials
 * are not painted over the photograph.
 */
test.describe("avatar rendering states", () => {
  /**
   * Serve every avatar image from memory, as a real, decodable PNG.
   *
   * ## Why this test does not fetch the real image
   *
   * The storage key is deterministic: <userId>/avatar.<ext>. So every run of
   * this file asks the optimiser for the SAME /_next/image URL, and our own
   * origin caches that entry for up to a year (max-age=31536000). Repeatedly
   * uploading and removing against one test account walks that cache through
   * states the test does not control, including entries captured while the
   * underlying object did not exist.
   *
   * The resulting failure is indistinguishable from a product bug: the write
   * succeeds, the action returns ok, a direct fetch of the object succeeds, and
   * the avatar still shows initials. That is a real limitation of the product,
   * recorded in docs/AVATAR_RENDERING.md, and it is the optimiser's cache rather
   * than the component's state machine that decides the outcome.
   *
   * So the mutual-exclusion contract is asserted against an image the test
   * controls. What is under test here is the component: exactly one visible
   * state per frame, and the right one in each situation. Whether a given cache
   * entry on a shared origin decodes is not a property of this component, and
   * asserting it made this file pass on some runs and fail on runs that followed
   * other runs.
   *
   * The inverse case, a dead object, is still exercised for real below by
   * aborting the request, so both directions of the state machine are covered
   * without depending on what the cache happens to be holding.
   */
  async function serveWorkingAvatarImages(page: import("@playwright/test").Page) {
    await page.route("**/_next/image**", async (route) => {
      const target = new URL(route.request().url()).searchParams.get("url") ?? "";
      if (target.includes("/storage/v1/object/public/avatars/")) {
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          // A real 1x1 PNG, so the browser decodes it and fires load.
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            "base64"
          ),
        });
        return;
      }
      await route.continue();
    });
  }

  /**
   * Wait until the single avatar in `scope` reports the expected state.
   *
   * This must be a retrying assertion rather than a single sample. The state is
   * "initials" until the image has actually loaded, so at the instant a
   * server-rendered avatar first appears the correct state is still "initials".
   * Sampling once there reported the transition itself as a failure. If the image
   * never loads â€” a real defect â€” this times out, which is the behaviour wanted.
   */
  async function expectState(
    scope: import("@playwright/test").Locator,
    expected: "image" | "initials"
  ) {
    await expect(scope).toHaveAttribute("data-avatar-state", expected, {
      timeout: 30_000,
    });
  }

  /**
   * Every avatar in `scope` must be SHOWING exactly one of the two states.
   *
   * Presence in the DOM is deliberately not the test. While an image is loading
   * it is present but hidden, and that is correct: an element that is not
   * rendered cannot load at all, so requiring the image to be absent until it
   * has loaded deadlocks and the picture never appears. What must never happen is
   * both states being visible at once, so that is what is counted.
   *
   * Returns the states found so a test can assert which one, but throws if the
   * total is anything other than the number of avatars. "Two images and one set
   * of initials" is the bug; so is one avatar painting both.
   */
  async function assertExclusive(
    page: import("@playwright/test").Page,
    scope: import("@playwright/test").Locator,
    /**
     * How many avatar frames `scope` should contain. Omit to derive it: the
     * invariant that matters is one state per frame, not how many frames a page
     * happens to have. /settings carries two (the header and the preview), the
     * profile page two, the home page one, and hardcoding those made this a test
     * of page layout rather than of the avatar.
     */
    expectedAvatars?: number
  ) {
    const found = await scope.evaluate((root) => {
      // `checkVisibility` is what the browser itself uses, and it accounts for
      // `visibility: hidden`, zero size, and `display: none`.
      const shown = (sel: string) =>
        [...root.querySelectorAll(sel)].filter((el) =>
          (el as HTMLElement).checkVisibility
            ? (el as HTMLElement).checkVisibility()
            : el.getClientRects().length > 0
        ).length;
      const roots = [...root.querySelectorAll('[data-testid="user-avatar"]')];
      return {
        visibleImages: shown('[data-testid="user-avatar-image"]'),
        visibleInitials: shown('[data-testid="user-avatar-initials"]'),
        presentImages: root.querySelectorAll('[data-testid="user-avatar-image"]').length,
        roots: roots.length,
        // A frame showing both at once is the original defect, however produced.
        bothVisible: roots.filter(
          (r) =>
            r.querySelector('[data-testid="user-avatar-image"]')?.checkVisibility() &&
            r.querySelector('[data-testid="user-avatar-initials"]')?.checkVisibility()
        ).length,
        states: roots.map((r) => r.getAttribute("data-avatar-state")),
      };
    });

    expect(found.bothVisible, "an avatar frame was showing both states").toBe(0);
    const frames = expectedAvatars ?? found.roots;
    expect(found.roots, "unexpected number of avatar frames").toBe(frames);
    expect(frames, "the scope contained no avatar at all").toBeGreaterThan(0);
    // The core assertion: exactly one VISIBLE state per frame.
    expect(
      found.visibleImages + found.visibleInitials,
      `expected exactly one visible state per avatar, saw ${found.visibleImages} image(s) and ${found.visibleInitials} initial(s) across ${found.roots} frame(s)`
    ).toBe(frames);
    return found;
  }

  /** Make the optimizer's fetch of the avatar fail, as a dead object would. */
  async function breakAvatarImages(page: import("@playwright/test").Page) {
    await page.route("**/_next/image**", async (route) => {
      const target = new URL(route.request().url()).searchParams.get("url") ?? "";
      if (target.includes("/storage/v1/object/public/avatars/")) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
  }

  test.afterEach(async ({ page }) => {
    // Never leave a picture on a QA account. The residue check in
    // `db:verify` counts avatar rows, so a test that fails midway must not turn
    // into a permanent trace.
    await page.goto("/settings").catch(() => {});
    const remove = page.getByTestId("avatar-remove-button");
    if (await remove.isVisible().catch(() => false)) {
      await remove.click();
      await expect(remove).toHaveCount(0, { timeout: 30_000 }).catch(() => {});
    }
  });

  for (const width of [390, 1440]) {
    test(`a real picture and the initials are never both in the frame (${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await signIn(page, ACCOUNTS.seller.email);
      // A controlled image, so the assertion is about the component rather
      // than about a year-long cache entry on the optimiser.
      await serveWorkingAvatarImages(page);
      await page.goto("/settings");

      // With no picture: only initials, in every avatar on the page. The count
      // is derived, because the invariant is one state per frame.
      const noPicture = await assertExclusive(page, page.locator("body"));
      expect(new Set(noPicture.states)).toEqual(new Set(["initials"]));

      // Store a real picture through the real uploader.
      await page.getByTestId("avatar-file-input").setInputFiles({
        name: "me.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });

      const previewSection = page
        .getByTestId("avatar-upload-button")
        .locator("xpath=ancestor::section");

      /*
       * The uploader is optimistic: a local blob and the Remove control both
       * appear as soon as the file is picked, before the server has stored
       * anything. So "the Remove button is visible" is not proof the round trip
       * happened.
       *
       * The blob itself is deliberately NOT waited on. It is a transient
       * optimistic state that the server round trip replaces, and against a
       * local server that transition is often faster than a test can observe â€”
       * asserting it was visible made this test fail for the right reason at the
       * wrong moment. What matters is the stable end state: the preview is
       * rendered from the stored key, and the blob is gone rather than left
       * over the top of it.
       */
      await expectState(previewSection.getByTestId("user-avatar"), "image");
      await expect(
        previewSection.getByTestId("avatar-preview-blob")
      ).toHaveCount(0);
      await expect(page.getByTestId("avatar-remove-button")).toBeVisible();

      // Settings preview: the image, and nothing else in that frame.
      const withPicture = await assertExclusive(page, previewSection, 1);
      expect(withPicture.states).toEqual(["image"]);

      // A different surface, so this is not just the uploader's own state: the
      // header on the home page.
      await page.goto("/");
      const header = page.locator("header");
      await expectState(header.getByTestId("user-avatar"), "image");
      const inHeader = await assertExclusive(page, header, 1);
      expect(inHeader.states).toEqual(["image"]);

      // And the public profile, the largest frame in the product.
      await page.goto(`/profile/${ACCOUNTS.seller.username}`);
      const profile = page.getByTestId("profile-header");
      await expectState(profile.getByTestId("user-avatar"), "image");
      const onProfile = await assertExclusive(page, profile, 1);
      expect(onProfile.states).toEqual(["image"]);
    });
  }

  test("an avatar that fails to load falls back to initials and nothing else", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.seller.email);
    await page.goto("/settings");
    await page.getByTestId("avatar-file-input").setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    await expect(page.getByTestId("avatar-remove-button")).toBeVisible({
      timeout: 60_000,
    });

    // A deleted object, a stale CDN entry, an optimiser failure: all arrive as
    // a failed image request, and all must end at letters rather than a torn
    // icon or a photo with letters on top of it.
    await breakAvatarImages(page);
    await page.goto(`/profile/${ACCOUNTS.seller.username}`);

    const profile = page.getByTestId("profile-header");
    await expectState(profile.getByTestId("user-avatar"), "initials");
    const broken = await assertExclusive(page, profile, 1);
    expect(broken.states).toEqual(["initials"]);
    expect(broken.presentImages, "a failed image was left in the DOM").toBe(0);

    // The same failure in the header, which is the smallest frame and the one
    // that is on every page.
    await page.goto("/");
    const header = page.locator("header");
    await expectState(header.getByTestId("user-avatar"), "initials");
    const inHeader = await assertExclusive(page, header, 1);
    expect(inHeader.states).toEqual(["initials"]);
  });
});
