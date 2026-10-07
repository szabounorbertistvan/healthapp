import { expect, test, type Page } from "@playwright/test";
import { authFile } from "./accounts";

// Andrei has no coach of his own, so /workout/build is the solo builder for
// him. Create a program, add a day, delete the program — the account is left
// as it was found. Covers createSoloProgram, addSoloProgramDay and
// deleteProgram, argument parsing (lib/validate.ts) included.
test.use({ storageState: authFile("coach") });

/**
 * Deletes the open program if it is the one named `name`. The builder opens
 * the most recently touched program, which a just-created one is; the
 * confirm row names it, so nothing else can be deleted by mistake.
 */
async function deleteIfOurs(page: Page, name: string) {
  await page.goto("/workout/build");
  await page.getByRole("heading", { name: "Build your program" }).waitFor();
  const del = page.getByRole("button", { name: "Delete program" });
  if (!(await del.isVisible())) return;
  await del.click();
  const confirm = page.getByText(`Delete “${name}”?`);
  if (!(await confirm.isVisible())) {
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    return;
  }
  // the confirm row's own Delete, not a day's swipe-to-delete one
  await confirm.locator("..").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText(`Delete “${name}”?`)).toHaveCount(0);
}

test("a solo program can be created, given a day, and deleted", async ({ page }) => {
  const name = `e2e ${Date.now()}`;
  const day = "e2e day";
  await page.goto("/workout/build");
  await expect(page.getByRole("heading", { name: "Build your program" })).toBeVisible();

  try {
    const newProgram = page.getByRole("button", { name: "New program" });
    if (await newProgram.isVisible()) await newProgram.click();
    await page.getByPlaceholder("Program name").first().fill(name);
    await page.getByRole("button", { name: "Create program" }).click();
    await expect(page.getByText("No days yet. Add your first one.")).toBeVisible();

    await page.getByPlaceholder("Day name, e.g. Chest and triceps").fill(day);
    await page.getByRole("button", { name: "Add a day" }).click();
    await expect(page.getByText("No days yet. Add your first one.")).toHaveCount(0);
    await expect(page.getByText(day).or(page.locator(`input[value="${day}"]`)).first()).toBeVisible();

    // deleting the day asks in a real modal: focus starts on Keep, Keep changes nothing, Delete removes it
    await page.getByTestId("swipe-delete-trigger").first().click();
    await page.getByTestId("swipe-delete-tray").first().click();
    const dialog = page.getByTestId("swipe-delete-confirm");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("role", "alertdialog");
    await expect(dialog.getByRole("button", { name: "Keep" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("No days yet. Add your first one.")).toHaveCount(0);
    await page.getByTestId("swipe-delete-trigger").first().click();
    await page.getByTestId("swipe-delete-tray").first().click();
    await dialog.getByTestId("swipe-delete-confirm-button").click();
    await expect(page.getByText("No days yet. Add your first one.")).toBeVisible();
  } finally {
    await deleteIfOurs(page, name);
  }
  await expect(page.getByText(`Delete “${name}”?`)).toHaveCount(0);
});
