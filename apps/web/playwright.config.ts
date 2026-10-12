// Playwright configuration (§10.1 Playwright; owned by the test-architect). `pnpm test:e2e` runs
// `playwright test` here. Browsers come from PLAYWRIGHT_BROWSERS_PATH (in the cloud environment,
// /opt/pw-browsers); nothing here installs them.
//
// Projects (§10.1): chromium and pseudo-rtl on every PR; firefox, webkit and perf on release
// candidates (selected with --project).
import { defineConfig, devices } from "@playwright/test";

// A-329: F-222 serves vite preview on 127.0.0.1:4173; A-395: E2E_WEB_PORT overrides the port
// (E2E_API_PORT the API's, read by F-222), so parallel runs don't collide.
// Tests tagged @perf (TP-12.4) run only in the perf project (§10.1: release candidates).
const PERF = /@perf/;

const BASE_URL =
  process.env["E2E_BASE_URL"] ?? `http://127.0.0.1:${process.env["E2E_WEB_PORT"] ?? "4173"}`;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @budmon/server e2e:serve",
    url: BASE_URL,
    reuseExistingServer: process.env["CI"] === undefined,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      // A-337: a fixed locale and zone, so TP-11.28's date entry is deterministic.
      use: { ...devices["Desktop Chrome"], locale: "en-US", timezoneId: "UTC" },
      grepInvert: PERF,
    },
    {
      name: "pseudo-rtl",
      use: { ...devices["Desktop Chrome"], locale: "ar-XB" },
      grepInvert: PERF,
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, grepInvert: PERF },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, grepInvert: PERF },
    {
      name: "perf",
      use: { ...devices["Desktop Chrome"] },
      grep: PERF,
    },
  ],
});
