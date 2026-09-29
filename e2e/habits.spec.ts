import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";

test.use({ storageState: authFile("client") });

// A write round trip against the live project: tick a habit, see it persist
// across a reload, then untick it so the account is left as it was found.
test("ticking a habit persists and can be undone", async ({ page }) => {
  await page.goto("/habits");
  const tick = page.locator("main button[aria-pressed]").first();
  await expect(tick).toBeVisible();
  const before = await tick.getAttribute("aria-pressed");
  const after = before === "true" ? "false" : "true";
  const name = (await tick.innerText()).split("\n")[0];

  const row = () => page.locator("main button[aria-pressed]").filter({ hasText: name }).first();
  try {
    await row().click();
    await expect(row()).toHaveAttribute("aria-pressed", after);
    // wait for the server action before reloading, or the reload races it
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(row()).toHaveAttribute("aria-pressed", after);
  } finally {
    if ((await row().getAttribute("aria-pressed")) !== before) {
      await row().click();
      await page.waitForLoadState("networkidle");
      await page.reload();
      await expect(row()).toHaveAttribute("aria-pressed", before!);
    }
  }
});
