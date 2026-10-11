import { expect, test } from "@playwright/test";
import { prepare } from "./accounts";

/**
 * The link at the foot of every marketplace email (20261115100000): public,
 * nothing changes on GET, a bad link is refused without saying anything about
 * the account. A real token is signed in the database only, so the happy path
 * is exercised by the pgTAP suite (email_unsubscribe.test.sql), not here.
 */
const USER = "11111111-2222-4333-8444-555555555555";
const BAD = "0123456789abcdef0123456789abcdef";

test.beforeEach(async ({ context }) => prepare(context));

test("a link of the wrong shape says so, signed out", async ({ page }) => {
  const response = await page.goto(`/unsubscribe?u=${USER}&c=new_kudos&t=${BAD}`);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/unsubscribe\?/); // not bounced to /login
  await expect(page.locator("main").getByRole("alert")).toContainText("This link is not valid");
  await expect(page.getByRole("button", { name: "Stop these emails" })).toHaveCount(0);
});

test("a well-formed link asks first, and a forged token is refused", async ({ page }) => {
  await page.goto(`/unsubscribe?u=${USER}&c=booking&t=${BAD}`);
  await expect(page.getByText("Stop emails about: Bookings?")).toBeVisible();
  await page.getByRole("button", { name: "Stop these emails" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(/This link is not valid|Could not save/);
});

test("one-click: a browser GET lands on the page, a forged POST is refused", async ({ page, request }) => {
  await page.goto(`/unsubscribe/one-click?u=${USER}&c=booking&t=${BAD}`);
  await expect(page).toHaveURL(new RegExp(`/unsubscribe\\?u=${USER}&c=booking&t=${BAD}$`));

  const malformed = await request.post(`/unsubscribe/one-click?u=${USER}&c=booking&t=nope`, {
    form: { "List-Unsubscribe": "One-Click" },
    maxRedirects: 0,
  });
  expect(malformed.status()).toBe(400);
});
