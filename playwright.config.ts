import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. They drive the real app against the live Supabase project
 * with the seeded test accounts (supabase/seed/accounts.sql, demo-data.sql) â€”
 * there is no other backend. Specs must therefore leave no trace: read-only,
 * or undo their own write in the same test.
 *
 * Reuses a dev server already on :3000 (CLAUDE.md: one per working tree) and
 * starts one only when nothing answers there.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  // Each PostgREST call from a dev box costs ~150 ms and a first Turbopack
  // compile of a route several seconds, so the defaults are too tight.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // One worker against the dev server: under concurrent requests Turbopack
  // sometimes renders a (client) page without the root I18nProvider ("useI18n
  // must be used inside <I18nProvider>", a 500). A production build
  // (`next start`, E2E_BASE_URL=http://localhost:3100) passes with
  // --workers=3, so it is a dev-server artifact, not an app bug.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : [["list"], ["html", { outputFolder: "e2e/.report", open: "never" }]],
  use: {
    baseURL,
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run web",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
