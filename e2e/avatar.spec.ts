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
 * The authorization model underneath is proved where it can be proved exactly —
 * `scripts/db/verify-engine.mjs` § "avatars" drives the real Storage and REST
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
    // all — not "allowed but sanitised", simply absent.
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
