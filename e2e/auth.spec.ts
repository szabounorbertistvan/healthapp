import { expect, test } from "@playwright/test";
import { ACCOUNTS, prepare, signIn } from "./accounts";

test.beforeEach(async ({ context }) => prepare(context));

test("a signed-out visitor is sent to the landing page", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/$/);
});

test("a wrong password is refused with a message", async ({ page }) => {
  await signIn(page, ACCOUNTS.client, "definitely-not-the-password");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a client who opens a coach route lands on their own home", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "e2e/.auth/client.json" });
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/today/);
  await context.close();
});
