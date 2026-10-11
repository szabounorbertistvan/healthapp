import { expect, test, type Page } from "@playwright/test";
import { authFile } from "./accounts";

/**
 * The marketplace email switches (docs/MARKETPLACE_EMAIL.md §6): defaults by
 * kind, a flip that survives a reload, and "Your coach page" only for a coach.
 * Undoes its own write: the switch ends where it started.
 */
const card = (page: Page) => page.locator("div.glass", { has: page.getByText("Email notifications", { exact: true }) });
const toggle = (page: Page, label: string) =>
  card(page).locator("div.flex", { has: page.getByText(label, { exact: true }) }).getByRole("switch");

test.describe("client", () => {
  test.use({ storageState: authFile("client") });

  test("sees the client switches, and a flip is saved", async ({ page }) => {
    await page.goto("/account");
    await expect(card(page)).toBeVisible();
    await expect(card(page).getByRole("switch")).toHaveCount(4);
    await expect(card(page).getByText("Your coach page", { exact: true })).toHaveCount(0);

    const messages = toggle(page, "New messages");
    const before = (await messages.getAttribute("aria-checked")) === "true";
    await messages.click();
    await expect(messages).toHaveAttribute("aria-checked", String(!before));
    await expect(messages).toBeEnabled();
    await page.reload();
    await expect(toggle(page, "New messages")).toHaveAttribute("aria-checked", String(!before));

    await toggle(page, "New messages").click(); // undo
    await expect(toggle(page, "New messages")).toHaveAttribute("aria-checked", String(before));
    await expect(toggle(page, "New messages")).toBeEnabled();
    await page.reload();
    await expect(toggle(page, "New messages")).toHaveAttribute("aria-checked", String(before));
  });
});

test.describe("coach", () => {
  test.use({ storageState: authFile("coach") });

  test("also gets the coach-page switch on /settings", async ({ page }) => {
    await page.goto("/settings");
    await expect(card(page).getByRole("switch")).toHaveCount(5);
    await expect(toggle(page, "Your coach page")).toBeVisible();
  });
});
