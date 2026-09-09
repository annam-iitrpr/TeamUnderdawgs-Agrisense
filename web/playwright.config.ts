import { defineConfig, devices } from "@playwright/test";

/**
 * Two profiles, selected with E2E_PROFILE:
 *
 *   contract-fixture (default) — the UI runs against fixture responses shaped
 *     from the v1 contract. Isolated, no backend required. This proves layout,
 *     states and accessibility, NOT integration.
 *   live-local — the UI runs against the real API, PostgreSQL and the Firebase
 *     Auth Emulator with request mocking disabled. This is the profile that
 *     counts as integration evidence.
 *
 * A passing contract-fixture run is never reported as integration coverage.
 */
const profile = process.env.E2E_PROFILE ?? "contract-fixture";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    extraHTTPHeaders: { "x-e2e-profile": profile },
  },
  projects: [
    { name: "mobile-360", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } } },
    { name: "mobile-390", use: { ...devices["iPhone 13"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
