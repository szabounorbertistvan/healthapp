import { expect, fence, test } from "./fixtures";
import { prepare } from "../e2e/accounts";
import { ACCOUNTS, PASSWORD } from "./accounts";
import { target } from "./target";

// The production guard, proven from inside a browser. target() (unit-tested in
// scripts/lib/local-target.test.mjs) refuses a hosted address before anything
// starts; these check what the running app actually does.

const HOSTED = "https://caiaretlxiljiiuoirtp.supabase.co";

test("a request to a hosted Supabase never leaves the browser, and is reported", async ({ browser }) => {
  // its own context: the auto fence on `page` would (rightly) fail this test for the request it makes on purpose
  const context = await browser.newContext();
  const violations = await fence(context);
  const page = await context.newPage();
  await page.goto("/login");
  const outcome = await page.evaluate(async (url) => {
    try {
      await fetch(url, { method: "POST", body: "{}" });
      return "answered";
    } catch {
      return "blocked";
    }
  }, `${HOSTED}/auth/v1/token?grant_type=password`);
  expect(outcome).toBe("blocked");
  expect(violations()).toEqual([`POST ${HOSTED}/auth/v1/token?grant_type=password (fetch)`]);
  await context.close();
});

test("signing in talks to the local stack and nowhere else", async ({ page }) => {
  await prepare(page.context());
  const local = new URL(target().supabaseUrl).host;
  const auth: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/auth/v1/")) auth.push(new URL(r.url()).host);
  });
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(ACCOUNTS.clientA);
  await page.getByPlaceholder("Password", { exact: true }).fill(PASSWORD);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  expect(auth.length, "the sign-in went through GoTrue").toBeGreaterThan(0);
  expect(new Set(auth)).toEqual(new Set([local]));
  // the auto fence then asserts nothing else tried to leave
});
