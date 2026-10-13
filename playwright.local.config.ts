import { defineConfig, devices } from "@playwright/test";
import { target } from "./e2e-local/target";

/**
 * The LOCAL end-to-end suite (e2e-local/), kept apart from playwright.config.ts
 * (e2e/, which reads the live project with the shared test accounts).
 *
 * This one writes, so it only ever runs against a stack on this machine —
 * target() throws for anything else — and with its own seeded accounts
 * (supabase/seed/e2e.sql). With nothing configured it starts everything itself:
 * the Docker-less Supabase (scripts/pgtest/stack.mjs: Postgres + GoTrue +
 * PostgREST), then a production build of the app pointed at it. In CI with
 * `supabase start`, pass E2E_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY and a
 * running app at E2E_LOCAL_BASE_URL (see e2e-local/README.md).
 *
 *   npm run e2e:local
 */
const t = target();
// e2e/accounts.ts' prepare() sets the locale cookie for this origin
process.env.E2E_BASE_URL = t.appUrl;

// The app is built and served with the local stack and nothing else: process
// env wins over apps/web/.env.local in Next, so the live project's services a
// developer keeps there (Stripe, Cloudinary, Places, analytics, push) are blanked
// rather than inherited. The Supabase URL and key are the local stack's.
const appEnv = {
  NEXT_PUBLIC_SUPABASE_URL: t.supabaseUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: t.anonKey,
  NEXT_PUBLIC_SITE_URL: t.appUrl,
  SUPABASE_SERVICE_ROLE_KEY: "",
  STRIPE_SECRET_KEY: "",
  CLOUDINARY_CLOUD_NAME: "", CLOUDINARY_API_KEY: "", CLOUDINARY_API_SECRET: "",
  GOOGLE_PLACES_API_KEY: "",
  NEXT_PUBLIC_GA_ID: "",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "",
};
const port = new URL(t.appUrl).port || "3210";

export default defineConfig({
  testDir: "./e2e-local",
  outputDir: "./e2e-local/.results",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // specs own disjoint data (their own accounts or run-tagged rows), so files may run side by side
  fullyParallel: false,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { outputFolder: "e2e-local/.report", open: "never" }]] : [["list"], ["html", { outputFolder: "e2e-local/.report", open: "never" }]],
  use: {
    baseURL: t.appUrl, locale: "en-US", trace: "retain-on-failure", screenshot: "only-on-failure",
    // a machine whose preinstalled Chromium is not the build this Playwright pins (a sandbox
    // that may not download one) points at its own; unset, Playwright uses its pinned build
    launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "local", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"], testIgnore: /auth\.setup\.ts/ },
  ],
  webServer: t.external ? undefined : [
    {
      command: "node scripts/pgtest/stack.mjs",
      url: `${t.supabaseUrl}/health`,
      timeout: 300_000,
      reuseExistingServer: true,
      stdout: "ignore",
    },
    {
      // a production build: the dev server's Turbopack 500s under parallel load (CLAUDE.md)
      command: `npx next build && npx next start -p ${port} -H localhost`,
      cwd: "apps/web",
      url: t.appUrl,
      env: appEnv,
      timeout: 600_000,
      // never adopt an app someone else started: it could be wired to the live
      // project. Anything already on the port fails the run instead.
      reuseExistingServer: false,
    },
  ],
});
