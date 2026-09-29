import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * The seeded test accounts. The password is the one supabase/seed/accounts.sql
 * sets; E2E_PASSWORD overrides it if the seed ever changes.
 */
export const PASSWORD = process.env.E2E_PASSWORD ?? "HealthApp!Dev2026";

export const ACCOUNTS = {
  client: "client@healthapp.test", // Maria, Andrei's client
  coach: "trainer@healthapp.test", // Andrei
  coach2: "trainer2@healthapp.test", // Cristina — a second roster, for isolation
} as const;

export type Who = keyof typeof ACCOUNTS;

export const authFile = (who: Who) => path.join(__dirname, ".auth", `${who}.json`);

/** English UI and no cookie notice, so selectors can rely on copy. */
export async function prepare(context: BrowserContext) {
  await context.addCookies([{ name: "bg-locale", value: "en", url: process.env.E2E_BASE_URL ?? "http://localhost:3000" }]);
  await context.addInitScript(() => {
    try {
      localStorage.setItem("bg-cookie-notice-v1", new Date().toISOString());
    } catch {}
  });
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password", { exact: true }).fill(password);
  await page.locator("form button[type=submit]").click();
}
