import { expect, test } from "@playwright/test";
import { authFile, prepare } from "./accounts";

/**
 * The admin panel, read-only: every section opens for the seeded admin
 * (admin@healthapp.test) without landing on the admin error boundary, and
 * stays closed to a client and a coach. Nothing is decided, suspended or
 * edited — those writes are covered by supabase/tests/admin_panel.test.sql and
 * the review suites. The admin session comes from auth.setup.ts like the
 * others.
 */

const SECTIONS = [
  "/admin",
  "/admin/users",
  "/admin/activity",
  "/admin/auth",
  "/admin/invitations",
  "/admin/workouts",
  "/admin/exercises",
  "/admin/foods",
  "/admin/nutrition",
  "/admin/gyms",
  "/admin/coaches",
  "/admin/coach-applications",
  "/admin/social",
  "/admin/challenges",
  "/admin/notifications",
  "/admin/feedback",
  "/admin/errors",
  "/admin/system",
  "/admin/search",
  "/admin/reports",
  "/admin/marketplace",
] as const;

const LOAD_ERROR = "Could not load this section.";

test.describe("admin", () => {
  test.use({ storageState: authFile("admin") });
  test.setTimeout(240_000);

  test("every section opens without the error boundary", async ({ page, context }) => {
    await prepare(context);
    const failed: string[] = [];
    for (const path of SECTIONS) {
      const res = await page.goto(path);
      await page.waitForLoadState("networkidle");
      const url = new URL(page.url()).pathname;
      if (!res || res.status() >= 400) failed.push(`${path}: HTTP ${res?.status()}`);
      else if (url !== path) failed.push(`${path}: redirected to ${url}`);
      else if (await page.getByText(LOAD_ERROR).isVisible()) failed.push(`${path}: load error`);
    }
    expect(failed, failed.join("\n")).toEqual([]);
  });

  test("a user's page opens from the users list", async ({ page, context }) => {
    await prepare(context);
    await page.goto("/admin/users");
    const link = page.locator('a[href^="/admin/users/"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]{36}/);
    await expect(page.getByText(LOAD_ERROR)).toHaveCount(0);
  });
});

for (const who of ["client", "coach"] as const) {
  test.describe(`${who} is kept out`, () => {
    test.use({ storageState: authFile(who) });

    test("/admin redirects away", async ({ page, context }) => {
      await prepare(context);
      await page.goto("/admin/users");
      await expect(page).not.toHaveURL(/\/admin/);
    });
  });
}
