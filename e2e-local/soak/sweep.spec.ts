import { expect, test } from "../fixtures";
import { soakAuth, SOAK_COACH_SLUG, type SoakWho } from "./accounts";
import { noteOrphans } from "./helpers";

// Every screen each of the three opens, every round: it answers (< 400), it
// does not send them to the login page, and it shows no error boundary. The
// fixtures add the rest — no hydration mismatch, no request leaving the
// machine — and attach the browser's console errors to a failure. Detail pages
// are reached through the first link their list shows, so they follow whatever
// the earlier rounds have written.
const CLIENT = [
  "/today", "/workout", "/workout/build", "/workout/import", "/food", "/food/plan", "/recipes", "/habits",
  "/progress", "/check-in", "/coach", "/feed", "/saved", "/people", "/notifications", "/achievements",
  "/challenges", "/leaderboards", "/fitness-score", "/streak", "/routines", "/exercises", "/gyms", "/reports",
  "/account", "/billing", "/onboarding", "/coaches", "/coaches?all=1", `/coaches/${SOAK_COACH_SLUG}`,
  "/coaches/saved", "/coaches/bookings", "/coaches/requests",
];
const COACH = [
  "/dashboard", "/clients", "/clients/challenges", "/programs", "/programs/new", "/nutrition", "/nutrition/new",
  "/library", "/check-ins", "/messages", "/marketplace", "/marketplace/share", "/requests", "/bookings",
  "/bookings/availability", "/reviews", "/settings", "/settings/coach-profile", "/onboarding",
  // a coach trains too: the client surface is theirs as well
  "/today", "/workout", "/food", "/feed", "/progress",
];
const SCREENS: Record<SoakWho, string[]> = { coach: COACH, client: CLIENT, solo: CLIENT };

/** The first link on `from` whose href matches `pattern`, so a detail page is opened as a person would. */
const DETAILS: Record<SoakWho, [from: string, pattern: RegExp][]> = {
  coach: [["/clients", /^\/clients\/[0-9a-f-]{36}$/], ["/programs", /^\/programs\/[0-9a-f-]{36}$/], ["/nutrition", /^\/nutrition\/[0-9a-f-]{36}$/], ["/messages", /^\/messages\/[0-9a-f-]{36}$/]],
  client: [["/workout", /^\/workout\/[0-9a-f-]{36}$/], ["/exercises", /^\/exercises\/[0-9a-f-]{36}$/], ["/achievements", /^\/achievements\/[^/]+$/], ["/routines", /^\/routines\/[0-9a-f-]{36}$/], ["/feed", /^\/feed\/[0-9a-f-]{36}$/]],
  solo: [["/workout", /^\/workout\/[0-9a-f-]{36}$/], ["/exercises", /^\/exercises\/[0-9a-f-]{36}$/], ["/challenges", /^\/challenges\/[0-9a-f-]{36}$/]],
};

async function visit(page: import("@playwright/test").Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status() ?? 0, `${path}: HTTP status`).toBeLessThan(400);
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname, `${path}: sent to the login page`).not.toMatch(/^\/login/);
  await expect(page.getByText("Something went wrong on this screen"), `${path}: error boundary`).toHaveCount(0);
  await expect(page.getByText("Application error"), `${path}: crash`).toHaveCount(0);
  await expect(page.getByText("This page could not be found."), `${path}: 404`).toHaveCount(0);
  await noteOrphans(page);
}

for (const who of Object.keys(SCREENS) as SoakWho[]) {
  test.describe(`sweep as ${who}`, () => {
    test.use({ storageState: soakAuth(who) });

    for (const path of SCREENS[who]) {
      test(path, async ({ page }) => visit(page, path));
    }

    for (const [from, pattern] of DETAILS[who]) {
      test(`${from} → first detail`, async ({ page }) => {
        await visit(page, from);
        const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
        const href = hrefs.find((h) => pattern.test(h.split(/[?#]/)[0]!));
        test.skip(!href, `nothing to open on ${from} yet`);
        await visit(page, href!);
      });
    }
  });
}
