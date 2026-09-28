import { expect, test } from "@playwright/test";

/**
 * No page may hydrate incorrectly.
 *
 * This guard exists because one did not get caught. `<DocumentCrossLinks />`
 * renders a `<p>`, and it had been wrapped in a `<p>` on /terms and /privacy.
 * That is invalid HTML, so the browser's parser closed the outer element
 * itself, the client tree no longer matched the server HTML, and React threw
 * error #418 and regenerated the subtree.
 *
 * What makes this worth automating: nothing else in the suite noticed. 263
 * unit tests, 136 database checks and 60 e2e tests all passed while two public
 * legal pages were shipping a hydration failure on every load, and the whole
 * tree was being thrown away and re-rendered. The existing e2e assertions check
 * what the page *shows* — and the page showed correctly, because React fixed it
 * in the browser. Only the error itself revealed the defect.
 *
 * So this asserts on the error, on every public page, rather than on content.
 * It also fails on any *other* uncaught error, which is the cheapest way to
 * keep this from being the one class of failure the suite is blind to.
 */
const PUBLIC_PAGES: ReadonlyArray<readonly [string, string]> = [
  ["home", "/"],
  ["browse", "/browse"],
  ["login", "/login"],
  ["signup", "/signup"],
  ["forgot password", "/forgot-password"],
  ["reset password", "/reset-password"],
  ["help", "/help"],
  ["fees", "/help/fees"],
  ["bidding rules", "/help/rules"],
  ["terms", "/terms"],
  ["privacy", "/privacy"],
  ["profile", "/profile/seller"],
  ["not found", "/definitely-not-a-page"],
];

test.describe("hydration", () => {
  for (const [name, path] of PUBLIC_PAGES) {
    test(`${name} hydrates without an uncaught error`, async ({ page }) => {
      const uncaught: string[] = [];

      page.on("pageerror", (error) => uncaught.push(String(error)));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        // A 404 on a deliberately missing page is the expected result, not a
        // defect, and the app logs it as a console error. Everything else counts.
        if (/status of 404/.test(text)) return;
        uncaught.push(text);
      });

      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      // Long enough for hydration to have run and for React to have re-rendered
      // had it mismatched, which is the window the error appears in.
      await page.waitForTimeout(1200);

      // Hydration failures specifically: React reports the mismatch as a thrown
      // error and, in production, also logs a warning naming the node.
      const hydration = uncaught.filter(
        (t) => /hydrat|did not match|Minified React error #(418|423|425)/i.test(t)
      );
      expect(
        hydration,
        `${path} produced a hydration error:\n${hydration.join("\n")}`
      ).toEqual([]);

      // And nothing else threw either.
      expect(
        uncaught,
        `${path} produced uncaught console/page errors:\n${uncaught.join("\n")}`
      ).toEqual([]);
    });
  }
});
