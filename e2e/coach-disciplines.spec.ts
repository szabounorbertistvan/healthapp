import { expect, test, type Browser } from "@playwright/test";
import { authFile, prepare } from "./accounts";

/**
 * Coach disciplines (migration 20261116100000). Read-only: the directory's
 * grouped filter, a discipline's landing page, and the coach editor's grouped,
 * searchable picker — nothing is toggled and saved. On a database without the
 * migration the new slugs are plain 404s and the groups are absent; those
 * checks skip with MISSING rather than fail.
 */

const MISSING = "migration 20261116100000 is not on this database yet";

async function anonymousPage(browser: Browser, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await prepare(context);
  return { context, page: await context.newPage() };
}

test.describe("directory", () => {
  test("the specialization filter is grouped and offers only what someone offers", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches?all=1");
    const filter = page.getByTestId("discovery-specializations").first();
    await expect(filter).toBeAttached();
    const groups = filter.locator("[data-category]");
    test.skip((await filter.getByRole("button").count()) === 0, "no published coach on this database");
    test.skip((await groups.count()) === 0, MISSING);
    // every chip that is not picked carries its coach count: no chip for a discipline nobody offers
    for (const chip of await filter.getByRole("button", { pressed: false }).all()) {
      await expect(chip).toHaveText(/\d+\s*$/);
    }
    // groups come in the fixed order and never repeat
    const order = await groups.evaluateAll((els) => els.map((e) => e.getAttribute("data-category")));
    const known = ["strength", "mind_body", "functional", "endurance", "combat", "other"];
    expect(order.filter((c) => !known.includes(c ?? ""))).toEqual([]);
    expect(order).toEqual([...order].sort((a, b) => known.indexOf(a!) - known.indexOf(b!)));
    expect(new Set(order).size).toBe(order.length);
    await context.close();
  });

  test("a discipline filter lives in the URL and keeps the location and format filters", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    const res = await page.goto("/coaches?specialization=yoga&online=true");
    expect(res?.status()).toBe(200);
    await expect(page.getByText("Something went wrong on this screen")).toHaveCount(0);
    const chips = page.getByTestId("active-filters");
    await expect(chips.getByRole("link", { name: "Remove filter Online" })).toBeVisible();
    test.skip((await chips.getByRole("link", { name: "Remove filter Yoga" }).count()) === 0, MISSING);
    // each coach once, whatever number of their specializations matched
    const hrefs = await page.getByTestId("coach-card").getByRole("link").evaluateAll((as) =>
      as.map((a) => a.getAttribute("href")).filter((h) => h && /^\/coaches\/[^/?]+$/.test(h)));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    await context.close();
  });

  test("a new discipline has its own landing page; a style too", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    const res = await page.goto("/coaches/yoga");
    test.skip(res?.status() === 404, MISSING);
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("coach-landing")).toHaveAttribute("data-kind", "specialization");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Yoga/);
    expect((await page.goto("/coaches/vinyasa-yoga"))?.status()).toBe(200);
    await context.close();
  });

  test("on a phone the grouped filter fits the sheet", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser, { width: 390, height: 844 });
    await page.goto("/coaches?all=1");
    await page.getByTestId("filters-open").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByTestId("discovery-specializations")).toBeAttached();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});

test.describe("coach editor", () => {
  test.use({ storageState: authFile("coach") });

  test("the picker is grouped and searchable, and keeps what was picked", async ({ page }) => {
    await page.goto("/settings/coach-profile?step=2");
    const picker = page.getByTestId("coach-specializations");
    test.skip((await picker.count()) === 0, "the seeded coach has no draft profile to edit");
    test.skip((await picker.locator("[data-category]").count()) < 2, MISSING);
    const picked = await picker.getByRole("button", { pressed: true }).allInnerTexts();
    const search = page.getByTestId("coach-specializations-search");
    await search.fill("vinyasa");
    await expect(picker.getByRole("button", { name: /Vinyasa Yoga/ })).toBeVisible();
    await expect(picker.getByRole("button", { name: /^Boxing$/ })).toHaveCount(0);
    // a search never hides a picked specialization
    expect((await picker.getByRole("button", { pressed: true }).allInnerTexts()).sort()).toEqual(picked.sort());
    await search.fill("");
    await expect(picker.getByRole("button", { name: /^Boxing$/ })).toBeVisible();
  });
});
