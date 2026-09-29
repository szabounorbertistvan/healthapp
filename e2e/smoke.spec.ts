import { expect, test, type Page } from "@playwright/test";
import { authFile, type Who } from "./accounts";

/**
 * Every main screen renders for the role that owns it: no error boundary, no
 * redirect away, and its heading shows once the streamed content arrives.
 */
const SCREENS: Record<Exclude<Who, "coach2">, [path: string, heading: string | RegExp][]> = {
  client: [
    ["/today", /day$/],
    ["/workout", "Training"],
    ["/food", "Breakfast"],
    ["/habits", "Habits"],
    ["/progress", "Progress"],
    ["/check-in", "Weekly check-in"],
    ["/coach", "Andrei Trainer"],
    ["/feed", "Feed"],
    ["/account", "Account"],
  ],
  coach: [
    ["/dashboard", "Who needs you today?"],
    ["/clients", "Clients"],
    ["/programs", "Programs"],
    ["/nutrition", "Nutrition plans"],
    ["/library", "Exercise library"],
    ["/check-ins", /^Check-ins to review/],
    ["/messages", "Messages"],
    ["/settings", "Settings"],
  ],
};

async function expectScreen(page: Page, path: string, heading: string | RegExp) {
  const response = await page.goto(path);
  expect(response?.status(), `${path} status`).toBeLessThan(400);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
  await expect(page.getByText("Something went wrong on this screen")).toHaveCount(0);
}

for (const [who, screens] of Object.entries(SCREENS) as [Who, typeof SCREENS.client][]) {
  test.describe(`${who} screens`, () => {
    test.use({ storageState: authFile(who) });
    for (const [path, heading] of screens) {
      test(path, async ({ page }) => expectScreen(page, path, heading));
    }
  });
}
