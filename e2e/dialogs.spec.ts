import { expect, test } from "@playwright/test";
import { authFile, prepare, signIn } from "./accounts";

// The overlays built on Base UI's Dialog: open, focus inside, Escape and an
// outside tap close, focus goes back to what opened it.
test.describe("share workout", () => {
  test.use({ storageState: authFile("client") });

  test("opens as a modal and closes on Escape and outside taps", async ({ page }) => {
    await page.goto("/today");
    const share = page.getByRole("button", { name: "Share Workout" }).first();
    // Today streams in; give the card time to arrive before deciding there is none
    const present = await share.waitFor({ timeout: 20_000 }).then(() => true, () => false);
    test.skip(!present, "no logged workout to share");
    await share.click();

    const dialog = page.getByRole("dialog", { name: "Share your workout" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" }).first()).toBeFocused();
    await expect(page.getByTestId("share-card-preview")).toBeVisible();

    // Tab stays inside the dialog
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(share).toBeFocused();

    await share.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 5); // the backdrop, outside the panel
    await expect(dialog).toHaveCount(0);
  });
});

test("the admin phone menu opens as a modal, closes on Escape and hands focus back", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await prepare(context);
  const page = await context.newPage();
  await signIn(page, "admin@healthapp.test");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/admin");

  const menu = page.getByRole("button", { name: "Admin sections" });
  await menu.click();
  const sheet = page.getByRole("dialog", { name: "Admin sections" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(menu).toBeFocused();

  // Not asserted here: a tap on a link in this sheet. In a production build
  // about one in four such taps never navigates (the RSC request is aborted),
  // with the old hand-rolled sheet as with this one — a separate bug.
  await context.close();
});
