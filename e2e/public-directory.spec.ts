import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS, PASSWORD, prepare } from "./accounts";

/**
 * The public, SEO-first coach directory (20261107100000).
 *
 * Runs against whatever the database has. Without a published coach the
 * crawler files, the directory and the sign-up gate are still checked; the
 * profile journey (1–10 of the brief) needs E2E_PUBLISHED_COACH and only
 * signs in — it writes nothing.
 */

const PUBLISHED = process.env.E2E_PUBLISHED_COACH ?? "";

async function anonymous(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext();
  await prepare(context);
  return { context, page: await context.newPage() };
}

async function robotsMeta(page: Page): Promise<string | null> {
  return page.locator('meta[name="robots"]').first().getAttribute("content").catch(() => null);
}

test.describe("crawlers", () => {
  test("robots.txt is served to anyone, points at the sitemap, and keeps the directory open", async ({ request }) => {
    const res = await request.get("/robots.txt", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
    expect(body).toContain("Disallow: /dashboard");
    expect(body).toContain("Allow: /coaches");
    // never a rule that would hide the directory itself
    expect(body).not.toMatch(/^Disallow: \/coach(es)?$/m);
  });

  test("sitemap.xml is served to anyone, with the directory in it", async ({ request }) => {
    const res = await request.get("/sitemap.xml", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("<urlset");
    expect(body).toMatch(/<loc>https?:\/\/[^<]+\/coaches<\/loc>/);
    // no reader-specific corner is ever listed
    expect(body).not.toMatch(/\/coaches\/(requests|saved|bookings)</);
  });
});

test.describe("anonymous", () => {
  test("the directory is a real, indexable page without an account", async ({ browser }) => {
    const { context, page } = await anonymous(browser);
    const res = await page.goto("/coaches?all=1");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/coaches\?all=1$/); // not bounced to /login
    await page.goto("/coaches");
    expect(await robotsMeta(page)).not.toMatch(/noindex/);
    await context.close();
  });

  test("Create a free account opens the sign-up form, with the way back attached", async ({ browser }) => {
    const { context, page } = await anonymous(browser);
    await page.goto("/login?next=%2Fcoaches%2Fsome-coach&mode=signup");
    await expect(page.getByPlaceholder("Full name")).toBeVisible();
    await context.close();
  });
});

test.describe("a published coach, logged out → signed in → logged out", () => {
  test.skip(!PUBLISHED, "set E2E_PUBLISHED_COACH to a published coach's slug");

  test("find, read the teaser, sign in through the gate, come back to the same coach", async ({ browser }) => {
    // 1–2. the directory, logged out, lists the coach
    const anon = await anonymous(browser);
    await anon.page.goto("/coaches?all=1");
    await expect(anon.page.locator(`a[href="/coaches/${PUBLISHED}"]`).first()).toBeVisible();

    // 3–4. the profile, logged out: the teaser, server-rendered and indexable
    const res = await anon.page.goto(`/coaches/${PUBLISHED}`);
    expect(res?.status()).toBe(200);
    const html = await res!.text();
    // the essentials are in the HTML itself, not only after JavaScript
    expect(html).toContain("<h1");
    expect(html).toContain("application/ld+json");
    await expect(anon.page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(anon.page.getByTestId("profile-gate")).toHaveAttribute("data-kind", "anonymous");
    // indexable only with the essentials (coachIndexable: headline, about, avatar,
    // a specialization, a service). A coach without them — the seeded demo coach
    // has no avatar — is noindex, and then must be out of the sitemap as well.
    if (/noindex/.test((await robotsMeta(anon.page)) ?? "")) {
      const sitemap = await (await anon.page.request.get("/sitemap.xml")).text();
      expect(sitemap).not.toContain(`/coaches/${PUBLISHED}<`);
    }
    await expect(anon.page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/coaches/${PUBLISHED}$`));
    await expect(anon.page.locator('meta[property="og:title"]')).toHaveAttribute("content", /\| Voinic$/);
    await expect(anon.page.locator('meta[property="og:url"]')).toHaveAttribute("content", new RegExp(`/coaches/${PUBLISHED}$`));
    const description = await anon.page.locator('meta[name="description"]').getAttribute("content");
    expect(description?.length ?? 0).toBeGreaterThan(20);
    const ld = JSON.parse((await anon.page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
    const types = (ld["@graph"] ?? []).map((n: { "@type": string }) => n["@type"]);
    expect(types).toEqual(["ProfilePage", "BreadcrumbList"]);
    expect(JSON.stringify(ld)).not.toContain("aggregateRating");
    // nothing private in what a stranger gets
    expect(html).not.toMatch(/@healthapp\.test|review_note|verification_message|suspension_reason/);

    // 5–6. the gate → sign in, with the way back attached
    await anon.page.getByTestId("gate-signin").click();
    await expect(anon.page).toHaveURL(new RegExp(`/login\\?next=%2Fcoaches%2F${PUBLISHED}`));
    await anon.page.getByPlaceholder("Email").fill(ACCOUNTS.client);
    await anon.page.getByPlaceholder("Password", { exact: true }).fill(PASSWORD);
    await anon.page.locator("form button[type=submit]").click();

    // 7–8. back on the same coach, signed in: no gate, the reader's own actions
    await expect(anon.page).toHaveURL(new RegExp(`/coaches/${PUBLISHED}$`), { timeout: 45_000 });
    await expect(anon.page.getByTestId("profile-gate")).toHaveCount(0);
    await expect(anon.page.getByRole("button", { name: /Follow|Following|Urmărește/ }).first()).toBeVisible();
    await anon.context.close();

    // 9–10. the same URL in a fresh logged-out context: the public page, intact
    const again = await anonymous(browser);
    const second = await again.page.goto(`/coaches/${PUBLISHED}`);
    expect(second?.status()).toBe(200);
    await expect(again.page.getByTestId("profile-gate")).toBeVisible();
    await again.context.close();
  });
});
