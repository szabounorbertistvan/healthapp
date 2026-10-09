import { expect, test, type Page } from "@playwright/test";

// Google Analytics is consent-gated and public-pages-only (lib/analytics.ts).
// gtag.js is intercepted and never reaches Google; the test only counts it.
// No prepare(): these specs need the banner unanswered.
async function countGtag(page: Page) {
  const hits: string[] = [];
  await page.route("https://www.googletagmanager.com/**", (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  await page.context().addCookies([{ name: "bg-locale", value: "en", url: process.env.E2E_BASE_URL ?? "http://localhost:3000" }]);
  return hits;
}

test("nothing analytics-related loads before a choice, nor after 'Essential only'", async ({ page }) => {
  const hits = await countGtag(page);
  await page.goto("/");
  const banner = page.getByRole("region", { name: "Cookie consent" });
  await expect(banner).toBeVisible();
  expect(hits).toHaveLength(0);
  await banner.getByRole("button", { name: "Essential only" }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.getByRole("region", { name: "Cookie consent" })).toBeHidden();
  expect(hits).toHaveLength(0);
  expect((await page.context().cookies()).some((c) => c.name.startsWith("_ga"))).toBe(false);
});

test("'Accept analytics' loads Google Analytics on a public page", async ({ page }) => {
  const hits = await countGtag(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Accept analytics" }).click();
  await expect.poll(() => hits.length).toBe(1);
  expect(hits[0]).toContain("id=G-");
  const queued = await page.evaluate(() =>
    ((window as unknown as { dataLayer: IArguments[] }).dataLayer ?? []).map((args) => JSON.stringify(Array.from(args))));
  expect(queued.some((q) => q.includes('"page_view"'))).toBe(true);
  expect(queued.some((q) => q.includes('"ad_storage":"denied"'))).toBe(true);
});

test("an accepted choice still loads nothing on a page that is not public", async ({ page }) => {
  const hits = await countGtag(page);
  await page.addInitScript(() => localStorage.setItem("bg-analytics-consent-v1", "granted"));
  await page.goto("/reset-password");
  await page.waitForLoadState("networkidle");
  expect(hits).toHaveLength(0);
});

test("the choice can be changed from the privacy page", async ({ page }) => {
  await countGtag(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("bg-analytics-consent-v1", "granted");
      sessionStorage.setItem("seeded", "1");
    }
  });
  await page.goto("/privacy");
  await expect(page.getByRole("region", { name: "Cookie consent" })).toBeHidden();
  await page.getByRole("button", { name: "Change cookie settings" }).first().click();
  await expect(page.getByRole("region", { name: "Cookie consent" })).toBeVisible();
});
