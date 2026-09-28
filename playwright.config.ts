import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // The machine has ~3.9 GB RAM: never run two browsers side by side.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // One retry, locally too (not just on CI). This machine has ~3.9 GB RAM and
  // the observed non-product failures are ambient: `net::ERR_NETWORK_IO_SUSPENDED`
  // mid-navigation and "timeout while setting up page" (browser could not
  // allocate a page). The same tests pass on the adjacent attempt and in the
  // other project, so a one-off infra blip should not read as a product
  // regression. A genuine defect fails both attempts and still reports red.
  retries: 1,
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
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
