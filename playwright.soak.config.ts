import { defineConfig, devices } from "@playwright/test";
import { target } from "./e2e-local/target";

/**
 * The SOAK suite (e2e-local/soak/): the soak trio — a coach, their client and
 * a solo trainee — play the app against each other, round after round, on the
 * throwaway local stack. `npm run e2e:soak` (scripts/soak.mjs) starts the stack
 * and a production build once, then runs this config in a loop and keeps a log
 * of every round; it is not meant to be run on its own.
 *
 * Same guard as playwright.local.config.ts: target() refuses anything that is
 * not this machine, and every browser context carries the network fence.
 */
const t = target();
if (!t.external) {
  throw new Error("playwright.soak.config.ts runs under scripts/soak.mjs (npm run e2e:soak), which starts the stack and the app.");
}
process.env.E2E_BASE_URL = t.appUrl;

export default defineConfig({
  testDir: "./e2e-local/soak",
  outputDir: process.env.SOAK_OUTPUT_DIR ?? "./e2e-local/.soak/last",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // the journeys hand state to each other (the coach writes, the client reads)
  // and share three accounts: one at a time, in file order
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: process.env.SOAK_JSON ?? "./e2e-local/.soak/last.json" }]],
  use: {
    baseURL: t.appUrl, locale: "en-US",
    // a step that cannot happen fails as itself, not as the whole test timing out
    actionTimeout: 20_000, navigationTimeout: 30_000, trace: "retain-on-failure", screenshot: "only-on-failure",
    launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "soak-setup", testMatch: /auth\.setup\.ts/ },
    { name: "soak", use: { ...devices["Desktop Chrome"] }, dependencies: ["soak-setup"], testIgnore: /auth\.setup\.ts/ },
    { name: "soak-phone", use: { ...devices["Pixel 7"] }, dependencies: ["soak-setup"], testMatch: /sweep\.spec\.ts/ },
  ],
});
