import { expect, test, type Browser, type Page } from "@playwright/test";
import { authFile, prepare } from "./accounts";

/**
 * /coaches (Coach Discovery) against the live project (needs 20261022100000;
 * Follow on a card needs 20261026100000). Bare /coaches is the Discovery
 * Home; ?all=1 or any search / filter is the listing.
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

/**
 * Type into the search box until the debounced URL shows it. A fill that
 * lands before hydration is a plain DOM edit React never sees (the cold-dev-
 * server flake of 2026-10-02), so it is retried, not waited on blindly.
 */
async function typeSearch(page: Page, text: string, url: RegExp) {
  await expect(async () => {
    await page.getByRole("searchbox").fill("");
    await page.getByRole("searchbox").fill(text);
    await expect(page).toHaveURL(url, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("anonymous", () => {
  test("the Discovery Home opens for anyone, with its metadata", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    const response = await page.goto("/coaches");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Find the right coach for you", level: 1 })).toBeVisible();
    // coaches → the recommended row; none published → the "no coaches yet" state
    await expect(page.getByTestId("home-recommended").or(page.getByTestId("coach-results-empty"))).toBeVisible();
    // anonymous: no city to guess from, so "near you" is a city picker, never a made-up location
    if (await page.getByTestId("home-near").count()) {
      await expect(page.getByTestId("home-near")).toHaveAttribute("data-kind", "anonymous");
    }
    await expect(page).toHaveTitle(/Find a Personal Trainer & Fitness Coach \| Voinic/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/coaches$/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Voinic/);
    await context.close();
  });

  test("a search with no match shows the empty state, and the way back restores the list", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches");
    await typeSearch(page, "zzqqxx-e2e", /\?q=zzqqxx-e2e/); // from the home: the listing, debounced into the URL
    await expect(page.getByTestId("coach-results-empty")).toHaveAttribute("data-kind", "no_match_search");
    await page.getByTestId("coach-results-empty").getByRole("link").click();
    await expect(page).toHaveURL(/\/coaches\?all=1$/); // every coach, still the listing
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
    await expect(page).toHaveURL(/\/coaches\?all=1$/);
    await page.goBack();
    await expect(page).toHaveURL(/specialization=hypertrophy/);
    await context.close();
  });

  test("a quick filter on the home opens the listing", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches");
    // with no published coach the home hides the quick filters (nothing to filter)
    const quick = page.getByRole("navigation", { name: "Quick filters" });
    test.skip(!(await quick.isVisible().catch(() => false)), "no published coach: the home shows no quick filters");
    await quick.getByRole("link", { name: "Online", exact: true }).click();
    await expect(page).toHaveURL(/\/coaches\?online=true$/);
    await expect(page.getByTestId("active-filters").getByRole("link", { name: "Remove filter Online" })).toBeVisible();
    await context.close();
  });

  test("See all opens the bare listing, with its filters", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches?all=1");
    await expect(page.getByTestId("coach-results-count")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await context.close();
  });

  test("a filter control writes the URL", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches?all=1");
    await page.getByRole("complementary", { name: "Filters" }).getByRole("button", { name: "In person" }).click();
    await expect(page).toHaveURL(/in_person=true/);
    await expect(page.getByTestId("active-filters").getByRole("link", { name: "Remove filter In person" })).toBeVisible();
    await context.close();
  });

  test("typing keeps the filters; Clear search keeps them and stays in the listing", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches?online=true");
    await typeSearch(page, "zzqqxx-e2e", /\?q=zzqqxx-e2e&online=true$/);
    await expect(page.getByTestId("coach-results-empty")).toHaveAttribute("data-kind", "no_match_filters");
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page).toHaveURL(/\/coaches\?online=true$/);
    await expect(page.getByRole("searchbox")).toHaveValue("");
    // the last filter off: every coach, in the listing (not the home)
    await page.getByTestId("active-filters").getByRole("link", { name: "Remove filter Online" }).click();
    await expect(page).toHaveURL(/\/coaches\?all=1$/);
    await expect(page.getByTestId("coach-results-count")).toBeVisible();
    await context.close();
  });

  test("filters combine, refresh keeps them, back walks them", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches?q=strength&city=cluj-napoca&online=true&specialization=strength&experience=3");
    const chips = page.getByTestId("active-filters");
    for (const name of ["Online", "Strength", "3+ years"]) {
      await expect(chips.getByRole("link", { name: `Remove filter ${name}` })).toBeVisible();
    }
    await page.reload();
    await expect(page.getByRole("searchbox")).toHaveValue("strength");
    await expect(chips.getByRole("link", { name: "Remove filter 3+ years" })).toBeVisible();
    await chips.getByRole("link", { name: "Remove filter 3+ years" }).click();
    await expect(page).not.toHaveURL(/experience=/);
    await expect(page).toHaveURL(/q=strength/); // the search survives removing a filter
    await page.goBack();
    await expect(page).toHaveURL(/experience=3/);
    await context.close();
  });

  test("verified, hybrid and gym are real filters (needs 20261027100000)", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    const response = await page.goto("/coaches?verified=true&hybrid=true");
    test.skip(response?.status() === 500, "migration 20261027100000 is not on this database yet");
    const chips = page.getByTestId("active-filters");
    await expect(chips.getByRole("link", { name: "Remove filter Verified" })).toBeVisible();
    await expect(chips.getByRole("link", { name: "Remove filter Hybrid" })).toBeVisible();
    await page.goto("/coaches?all=1");
    const filters = page.getByRole("complementary", { name: "Filters" });
    await filters.getByRole("button", { name: "Hybrid" }).click();
    await expect(page).toHaveURL(/hybrid=true/);
    await filters.getByRole("switch", { name: /Verified coaches only/ }).click();
    await expect(page).toHaveURL(/verified=true/);
    // a malformed gym id in a shared link is ignored, not an error
    const bad = await page.goto("/coaches?gym=not-a-uuid");
    expect(bad?.status()).toBe(200);
    await context.close();
  });

  test("on a phone the sheet keeps the search", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser, { width: 390, height: 844 });
    await page.goto("/coaches?q=strength");
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "In person" }).click();
    await expect(page).toHaveURL(/q=strength/);
    await expect(page).toHaveURL(/in_person=true/);
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
    // the home: rows swipe sideways inside themselves, the page never does
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.goto("/coaches?all=1");
    await page.getByRole("button", { name: "Filters" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Online" }).click();
    await expect(page).toHaveURL(/online=true/);
    // the close button carries the live count of what the taps above found
    await expect(sheet.getByTestId("filters-show")).toHaveText(/^(Show \d+ coaches?|Show 1 coach|No coaches — adjust filters)$/);
    await sheet.getByTestId("filters-show").click();
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
    const card = () => page.getByTestId("coach-card").filter({ has: page.locator(`a[href="/coaches/${PUBLISHED}"]`) });
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
      const card = page.getByTestId("coach-card").filter({ has: page.locator(`a[href="/coaches/${PUBLISHED}"]`) });
      // Follow sits on the card (20261026100000): a tap there follows, it does not open the profile
      const cardFollow = card.locator("button[aria-pressed]");
      if (await cardFollow.count()) {
        const was = await cardFollow.getAttribute("aria-pressed");
        await cardFollow.click();
        if (was === "true") await cardFollow.click(); // the second tap confirms an unfollow
        await expect(cardFollow).toHaveAttribute("aria-pressed", was === "true" ? "false" : "true");
        await expect(page).toHaveURL(/\/coaches\?/);
        await cardFollow.click();
        if (was === "false") await cardFollow.click();
        await expect(cardFollow).toHaveAttribute("aria-pressed", was!);
      }
      await card.getByRole("link", { name: /./ }).first().click();
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
