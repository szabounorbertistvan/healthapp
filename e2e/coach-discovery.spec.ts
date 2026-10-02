import { expect, test, type Browser } from "@playwright/test";
import { authFile, prepare } from "./accounts";

/**
 * /coaches (Coach Discovery) against the live project (needs 20261022100000).
 *
 * The listing, URL state, empty states and filters run as they are. The
 * tests that need a coach in the results read a published coach's slug from
 * E2E_PUBLISHED_COACH (and expect them in Cluj-Napoca with a Strength
 * specialization, as the restore-able test profile is set up); without it
 * they are skipped. Writes (a request, a follow) are undone in the test.
 */

const PUBLISHED = process.env.E2E_PUBLISHED_COACH ?? "";

async function anonymousPage(browser: Browser, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await prepare(context);
  return { context, page: await context.newPage() };
}

test.describe("anonymous", () => {
  test("the listing opens for anyone, with its metadata", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    const response = await page.goto("/coaches");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Find your coach", level: 1 })).toBeVisible();
    await expect(page.getByTestId("coach-results-count")).toBeVisible();
    await expect(page).toHaveTitle(/Find a Personal Trainer & Fitness Coach \| Voinic/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/coaches$/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Voinic/);
    await context.close();
  });

  test("a search with no match shows the empty state, and the way back restores the list", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches");
    await page.getByRole("searchbox").fill("zzqqxx-e2e");
    await expect(page).toHaveURL(/\?q=zzqqxx-e2e/); // debounced into the URL
    await expect(page.getByTestId("coach-results-empty")).toHaveAttribute("data-kind", "no_match_search");
    await page.getByTestId("coach-results-empty").getByRole("link").click();
    await expect(page).toHaveURL(/\/coaches$/);
    // back to the plain listing: coaches, or — with none published — the "no coaches yet" state, never "no match"
    await expect(page.getByTestId("coach-results-empty").and(page.locator('[data-kind="no_match_search"]'))).toHaveCount(0);
    await context.close();
  });

  test("filters live in the URL: chips, remove one, clear all, back", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches?online=true&specialization=hypertrophy");
    const chips = page.getByTestId("active-filters");
    await expect(chips.getByRole("link", { name: "Remove filter Online" })).toBeVisible();
    await expect(chips.getByRole("link", { name: "Remove filter Hypertrophy" })).toBeVisible();
    await chips.getByRole("link", { name: "Remove filter Online" }).click();
    await expect(page).toHaveURL(/\/coaches\?specialization=hypertrophy$/);
    await page.getByTestId("active-filters").getByRole("link", { name: "Clear all" }).click();
    await expect(page).toHaveURL(/\/coaches$/);
    await page.goBack();
    await expect(page).toHaveURL(/specialization=hypertrophy/);
    await context.close();
  });

  test("a filter control writes the URL", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches");
    await page.getByRole("complementary", { name: "Filters" }).getByRole("button", { name: "In person" }).click();
    await expect(page).toHaveURL(/in_person=true/);
    await expect(page.getByTestId("active-filters").getByRole("link", { name: "Remove filter In person" })).toBeVisible();
    await context.close();
  });

  test("filtered pages are not indexed, the listing is", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches?online=true");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await page.goto("/coaches");
    await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute("content", /noindex/);
    await context.close();
  });

  test("on a phone: one column, Filters opens a sheet", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser, { width: 390, height: 844 });
    await page.goto("/coaches");
    await page.getByRole("button", { name: "Filters" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Online" }).click();
    await expect(page).toHaveURL(/online=true/);
    await sheet.getByRole("button", { name: "Show results" }).click();
    await expect(sheet).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await context.close();
  });
});

test.describe("with a published coach", () => {
  test.skip(!PUBLISHED, "set E2E_PUBLISHED_COACH to a published coach's slug");

  test("anonymous: browse, search, filter, open the profile", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches");
    const card = () => page.getByTestId("coach-card").and(page.locator(`[href="/coaches/${PUBLISHED}"]`));
    await expect(card()).toBeVisible();
    // search by city, then a specialization filter, then a filter that excludes them
    await page.goto("/coaches?q=cluj");
    await expect(card()).toBeVisible();
    await page.goto("/coaches?city=cluj-napoca&specialization=strength");
    await expect(card()).toBeVisible();
    await page.goto("/coaches?specialization=powerlifting&experience=10&price_max=1");
    await expect(card()).toHaveCount(0);
    await page.goto("/coaches?city=cluj-napoca");
    await card().click();
    await expect(page).toHaveURL(new RegExp(`/coaches/${PUBLISHED}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await context.close();
  });

  test.describe("signed in", () => {
    test.use({ storageState: authFile("coach2") });

    test("search, open the profile, follow and start coaching — each undone", async ({ page }) => {
      await page.goto("/coaches?q=strength&online=true");
      await page.getByTestId("coach-card").and(page.locator(`[href="/coaches/${PUBLISHED}"]`)).click();
      await expect(page).toHaveURL(new RegExp(`/coaches/${PUBLISHED}$`));

      // follow, then unfollow (the second tap confirms)
      const follow = () => page.locator("button[aria-pressed]").filter({ hasText: /^(Follow|Following|Follow back|Unfollow)$/ }).first();
      const before = await follow().getAttribute("aria-pressed");
      await follow().click();
      if (before === "true") await follow().click();
      await expect(follow()).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
      await follow().click();
      if (before === "false") await follow().click();
      await expect(follow()).toHaveAttribute("aria-pressed", before!);

      // start coaching, then cancel the request
      const start = page.getByRole("button", { name: "Start coaching" }).first();
      test.skip(!(await start.isVisible().catch(() => false)), "this coach is not taking requests from this account");
      try {
        await start.click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Message (optional)").fill("E2E request — please ignore");
        await dialog.getByRole("button", { name: "Send request" }).click();
        await expect(dialog.getByTestId("coaching-request-sent")).toBeVisible();
        await dialog.getByRole("button", { name: "Close" }).click();
        await expect(page.getByTestId("coaching-request-pending").first()).toBeVisible();
      } finally {
        const cancel = page.getByRole("button", { name: "Cancel request" }).first();
        if (await cancel.isVisible().catch(() => false)) {
          await cancel.click();
          await expect(page.getByTestId("coaching-request-pending")).toHaveCount(0);
        }
      }
    });
  });
});
