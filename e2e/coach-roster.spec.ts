import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";

// A coach's roster is exactly their own clients — RLS through
// is_active_coach_of(), seen from the UI. Seed: supabase/seed/demo-data.sql.
const clientLinks = (page: import("@playwright/test").Page) => page.locator("main a[href^='/clients/']");

test.describe("Andrei", () => {
  test.use({ storageState: authFile("coach") });
  test("sees his clients and not Cristina's", async ({ page }) => {
    await page.goto("/clients");
    const main = page.locator("main");
    await expect(clientLinks(page).filter({ hasText: "Maria Client" }).first()).toBeVisible();
    await expect(clientLinks(page).filter({ hasText: "Ioana Marin" }).first()).toBeVisible();
    await expect(main.getByText("Alex Dinu")).toHaveCount(0);
  });

  test("opens a client's detail page", async ({ page }) => {
    await page.goto("/clients");
    await clientLinks(page).filter({ hasText: "Maria Client" }).first().click();
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Something went wrong on this screen")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Maria/ }).first()).toBeVisible();
  });
});

test.describe("Cristina", () => {
  test.use({ storageState: authFile("coach2") });
  test("sees her client and not Andrei's", async ({ page }) => {
    await page.goto("/clients");
    await expect(clientLinks(page).filter({ hasText: "Alex Dinu" }).first()).toBeVisible();
    await expect(page.locator("main").getByText("Maria Client")).toHaveCount(0);
  });
});
