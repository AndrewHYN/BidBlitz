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
