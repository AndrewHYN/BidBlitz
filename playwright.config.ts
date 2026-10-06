import { defineConfig, devices } from "@playwright/test";

/**
 * Where the suite runs.
 *
 * `PLAYWRIGHT_BASE_URL` decides, and the DEFAULT is deliberately the real
 * deployment, not localhost. A release validation that silently runs against a
 * dev server validates nothing: the whole suite passed for hours while a
 * five-hour-old node process was serving code from before the avatar feature
 * existed, and every new avatar test failed against it.
 *
 * Set `PLAYWRIGHT_BASE_URL=http://localhost:3000` to run against a local
 * server. Nothing else in this file needs to change.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "https://bidblitz.co.zw";

/** True when we are pointed at a remote deployment rather than a local server. */
const isRemote = /^https?:\/\//.test(baseURL) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(baseURL);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // The machine has ~3.9 GB RAM: never run two browsers side by side.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  /*
   * ZERO retries, deliberately.
   *
   * This was `retries: 1` from an earlier pass, justified by ambient
   * environment failures on this low-memory machine. That justification was
   * never tested, and a retry policy is the one thing that makes a green run
   * worthless: a test that fails once still reports green, and a real defect
   * that happens to be intermittent is exactly the defect you would most want
   * to see. A retry cannot tell "the product is fine" from "the second attempt
   * got lucky".
   *
   * So retries are off, and the failures must be fixed at their cause:
   * deterministic waits for a real state (see `waitForHydratedForm`), and
   * assertions that name the thing being waited for. If a test is genuinely
   * environment-sensitive, that is a finding about the test and it gets fixed
   * like one — not papered over with a retry or a sleep.
   *
   * Run it twice if you want a signal about flakiness; do not buy that signal
   * by making the reported result softer.
   */
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  // The suite publishes real auctions, uploads real files and places real bids
  // through the real app. Against a real Supabase project that means real rows,
  // so they must be removed when the run ends - otherwise every run leaves test
  // listings sitting on the public homepage, which is exactly what happened
  // before 2026-09-28. Best-effort by design: it warns loudly when it cannot
  // clean up, and never hides a skipped cleanup behind a green run.
  globalTeardown: "./e2e/global-teardown.mjs",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  /*
   * Only boot a local server when we are actually testing one. Pointed at the
   * deployment, starting `next dev` would waste minutes and would also be a
   * trap: a stale local server left over from a previous session gets reused
   * (that is what happened on 2026-09-28) and the suite then validates old code
   * while appearing to test the current build.
   */
  webServer: isRemote
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        // Fresh every run when testing locally: a reused server may predate
        // the code under test, which is precisely the bug this line prevents.
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
