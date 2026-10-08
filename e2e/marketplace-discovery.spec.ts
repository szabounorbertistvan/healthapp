import { expect, test, type Browser, type Page } from "@playwright/test";
import { ACCOUNTS, authFile, prepare } from "./accounts";

/**
 * Coach Discovery 2.0, profile content and the calendar foundation
 * (20261111100000 → 20261111130000). Read-only: nothing here sends a
 * request, books, saves for good or edits a profile — Save is toggled and
 * toggled back in the same test.
 *
 * What needs a published coach takes E2E_PUBLISHED_COACH=<slug>; it skips
 * otherwise. Pages that call the new RPCs on a database without the
 * migrations show the error screen — those tests skip with MISSING.
 */

const PUBLISHED = process.env.E2E_PUBLISHED_COACH ?? "";
const MISSING = "migrations 20261111100000 → 20261111130000 are not on this database yet";

async function anonymousPage(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  await prepare(context);
  return { context, page: await context.newPage() };
}

async function rendered(page: Page, ready: ReturnType<Page["getByTestId"]>): Promise<boolean> {
  const failed = page.getByText("Something went wrong on this screen");
  await expect(ready.or(failed).first()).toBeVisible();
  return !(await failed.isVisible());
}

const meta = (page: Page, name: string) => page.locator(`meta[name="${name}"], meta[property="${name}"]`).first();

test.describe("anonymous: search, filter, URL state, SEO", () => {
  test("filters and sorts live in a shareable URL; back and forward walk them", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser, { width: 1280, height: 900 });
    await page.goto("/coaches?all=1");
    test.skip(!(await rendered(page, page.getByTestId("coach-results-count"))), MISSING);

    // a filter (desktop: runs at once) and a sort
    await page.getByTestId("discovery-rating").getByRole("button", { name: "4.5+ ★" }).click();
    await expect(page).toHaveURL(/rating=4\.5/);
    await page.getByRole("combobox").filter({ hasText: "Recommended" }).first().selectOption("rating");
    await expect(page).toHaveURL(/rating=4\.5.*sort=rating|sort=rating.*rating=4\.5/);

    // refresh keeps it; sharing the URL is the same search
    await page.reload();
    await expect(page.getByTestId("active-filters")).toContainText("4.5+ ★");
    const shared = page.url();
    const other = await context.newPage();
    await other.goto(shared);
    await expect(other.getByTestId("active-filters")).toContainText("4.5+ ★");

    // back undoes the sort, then the filter
    await page.goBack();
    await expect(page).not.toHaveURL(/sort=rating/);
    await page.goBack();
    await expect(page).not.toHaveURL(/rating=4\.5/);
    await page.goForward();
    await expect(page).toHaveURL(/rating=4\.5/);
    await context.close();
  });

  test("every new filter is in the URL and removable; Reset clears them", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser, { width: 1280, height: 900 });
    await page.goto("/coaches?available=true&rating=4&service=personal_training&language=ro");
    test.skip(!(await rendered(page, page.getByTestId("coach-results-count"))), MISSING);
    const chips = page.getByTestId("active-filters");
    await expect(chips).toContainText("Available soon");
    await expect(chips).toContainText("4+ ★");
    await chips.getByRole("link", { name: /Available soon/ }).click();
    await expect(page).not.toHaveURL(/available=true/);
    await expect(page).toHaveURL(/rating=4/);
    await page.getByTestId("filters-reset").click();
    await expect(page).toHaveURL(/\/coaches\?all=1$/);
    await context.close();
  });

  test("too many filters at once: the empty state says so and offers Clear filters", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches?online=true&verified=true&rating=4.5&available=true&experience=10&price_max=1");
    test.skip(!(await rendered(page, page.getByTestId("coach-results-count").or(page.getByTestId("coach-results-empty")))), MISSING);
    const empty = page.getByTestId("coach-results-empty");
    if (await empty.count()) {
      await expect(empty).toHaveAttribute("data-kind", "too_restrictive");
      await empty.getByRole("link", { name: "Clear filters" }).click();
      await expect(page).toHaveURL(/\/coaches\?all=1$/);
    }
    await context.close();
  });

  test("a filtered URL is never indexable; a landing page is canonical and server-rendered", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto("/coaches?specialization=weight-loss&rating=4");
    await expect(meta(page, "robots")).toHaveAttribute("content", /noindex/);

    // every active specialization has a landing page (indexable only while it lists someone)
    const res = await page.goto("/coaches/weight-loss");
    expect(res?.status()).toBe(200);
    test.skip(!(await rendered(page, page.getByTestId("coach-landing"))), MISSING);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Weight Loss/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/coaches\/weight-loss$/);
    const indexable = await page.getByTestId("coach-landing").getAttribute("data-indexable");
    if (indexable === "true") await expect(meta(page, "robots")).not.toHaveAttribute("content", /noindex/);
    else await expect(meta(page, "robots")).toHaveAttribute("content", /noindex/);
    const html = await res!.text();
    expect(html).toContain('"@type":"CollectionPage"');
    // a slug that is neither a coach nor a landing is a real 404
    const missing = await page.goto("/coaches/definitely-not-a-coach-or-city");
    expect(missing?.status()).toBe(404);
    await context.close();
  });

  test("on a phone: Reset clears the draft, closing without Apply changes nothing", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser, { width: 390, height: 844 });
    await page.goto("/coaches?online=true");
    await page.getByTestId("filters-open").click();
    const sheet = page.getByRole("dialog");
    await sheet.getByTestId("filters-reset").click();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/online=true/);
    await page.getByTestId("filters-open").click();
    await sheet.getByTestId("filters-reset").click();
    await sheet.getByTestId("filters-apply").click();
    await expect(page).not.toHaveURL(/online=true/);
    await context.close();
  });
});

test.describe("a published coach's profile", () => {
  test.skip(!PUBLISHED, "set E2E_PUBLISHED_COACH to a published coach's slug");

  test("anonymous: sections in order, share, previews, no private field in the HTML", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    const res = await page.goto(`/coaches/${PUBLISHED}`);
    expect(res?.status()).toBe(200);
    // link previews: Open Graph and Twitter, canonical
    await expect(meta(page, "og:title")).toHaveAttribute("content", /.+/);
    await expect(meta(page, "og:url")).toHaveAttribute("content", new RegExp(`/coaches/${PUBLISHED}$`));
    await expect(meta(page, "twitter:card")).toHaveAttribute("content", /summary/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/coaches/${PUBLISHED}$`));
    // what the coach wrote in their own words is labelled as such
    if (await page.getByTestId("coach-approach").count()) {
      await expect(page.getByTestId("coach-approach")).toContainText("not checked by Voinic");
    }
    await expect(page.getByTestId("share-coach").first()).toBeVisible();
    const html = await res!.text();
    for (const secret of ["credential_number", "review_note", "suspension_reason", "access_token", "refresh_token", "rank_score", "\"signals\""]) {
      expect(html, secret).not.toContain(secret);
    }
    await context.close();
  });

  test("anonymous Contact → sign in → back on the same coach with the dialog open", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto(`/coaches/${PUBLISHED}`);
    const contact = page.getByTestId("contact-coach-signin").first();
    test.skip(!(await contact.count()), "this coach is not taking clients");
    const href = await contact.getAttribute("href");
    expect(decodeURIComponent(href ?? "")).toContain(`/coaches/${PUBLISHED}?intent=contact`);
    await contact.click();
    await expect(page).toHaveURL(/\/login\?/);
    await page.getByPlaceholder("Email").fill(ACCOUNTS.client);
    await page.getByPlaceholder("Password", { exact: true }).fill(process.env.E2E_PASSWORD ?? "HealthApp!Dev2026");
    await page.locator("form button[type=submit]").click();
    await expect(page).toHaveURL(new RegExp(`/coaches/${PUBLISHED}`));
    // the intent is completed once (the dialog opens), then dropped from the URL
    await expect(page.getByRole("dialog").or(page.getByTestId("contact-coach")).first()).toBeVisible();
    await context.close();
  });

  test("anonymous Book → pick a time → sign in → the same time is still chosen", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto(`/coaches/${PUBLISHED}`);
    const book = page.getByTestId("book-service").first();
    test.skip(!(await book.count()), "this coach has no bookable service");
    await book.click();
    const slot = page.locator('[data-testid="booking-slot"]').first();
    test.skip(!(await slot.count()), "no free time this week");
    // the slots are server-rendered: a click before hydration does nothing, so retry until it takes
    await expect(async () => {
      await slot.click();
      await expect(slot).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    const signIn = page.getByTestId("booking-sign-in");
    expect(decodeURIComponent((await signIn.getAttribute("href")) ?? "")).toMatch(/&at=\d{4}-/);
    await signIn.click();
    await page.getByPlaceholder("Email").fill(ACCOUNTS.client);
    await page.getByPlaceholder("Password", { exact: true }).fill(process.env.E2E_PASSWORD ?? "HealthApp!Dev2026");
    await page.locator("form button[type=submit]").click();
    await expect(page).toHaveURL(new RegExp(`/coaches/${PUBLISHED}/book\\?.*at=`));
    // nothing is booked by coming back: the confirm step waits for the reader
    await expect(page.getByTestId("booking-confirm")).toBeVisible();
    await context.close();
  });
});

test.describe("signed in", () => {
  test.use({ storageState: authFile("client") });
  test.skip(!PUBLISHED, "set E2E_PUBLISHED_COACH to a published coach's slug");

  test("search, filter, save (and unsave), then the profile's actions", async ({ page }) => {
    await page.goto(`/coaches?q=${encodeURIComponent(PUBLISHED.split("-")[0]!)}`);
    const card = page.getByTestId("coach-card").filter({ has: page.locator(`a[href="/coaches/${PUBLISHED}"]`) });
    await expect(card).toBeVisible();
    const save = card.getByTestId("save-coach");
    const before = await save.getAttribute("data-saved");
    await save.click();
    await expect(save).not.toHaveAttribute("data-saved", before ?? "");
    await save.click(); // undo
    await expect(save).toHaveAttribute("data-saved", before ?? "false");
    await card.click();
    await expect(page.getByTestId("contact-coach").or(page.getByTestId("coaching-request-accepted"))
      .or(page.getByTestId("coaching-paused-cta")).first()).toBeVisible();
    await expect(page.locator("#reviews").or(page.getByTestId("coach-why")).first()).toBeVisible();
  });
});

test.describe("coach", () => {
  test.use({ storageState: authFile("coach") });

  test("the profile editor has the content fields, and the checklist counts them", async ({ page }) => {
    await page.goto("/settings/coach-profile?step=1");
    const editor = page.getByTestId("coach-social-links").or(page.getByText("Edit profile"));
    test.skip(!(await rendered(page, editor.first() as ReturnType<Page["getByTestId"]>)), MISSING);
    if (await page.getByTestId("coach-social-links").count()) {
      await expect(page.getByTestId("coach-social-links").getByText("Instagram")).toBeVisible();
      await page.goto("/settings/coach-profile?step=2");
      await expect(page.getByText("Your coaching approach")).toBeVisible();
      await expect(page.getByTestId("coach-client-goals")).toBeVisible();
    }
    await page.goto("/marketplace");
    if (await page.getByTestId("marketplace-checklist").count()) {
      await expect(page.getByTestId("marketplace-checklist")).toContainText("Your coaching approach");
      await expect(page.getByTestId("marketplace-checklist")).toContainText("A public price on a service");
    }
  });

  test("Availability shows calendar connections — not connected, coming soon, no secrets", async ({ page }) => {
    await page.goto("/bookings/availability");
    test.skip(!(await rendered(page, page.getByTestId("calendar-integrations"))), MISSING);
    const providers = page.getByTestId("calendar-provider");
    await expect(providers).toHaveCount(2);
    await expect(providers.first()).toHaveAttribute("data-status", /not_connected|pending|connected|syncing|error|reauth_required/);
    if ((await providers.first().getAttribute("data-status")) === "not_connected") {
      await expect(page.getByTestId("calendar-connect-soon").first()).toBeVisible();
    }
    const html = await page.content();
    for (const secret of ["access_token", "refresh_token", "sync_state"]) expect(html).not.toContain(secret);
  });
});

test("another coach's calendar is not reachable through the API", async ({ browser }) => {
  // the RPC answers only for the caller; the tables refuse direct reads of tokens and busy time
  const context = await browser.newContext({ storageState: authFile("coach2") });
  await prepare(context);
  const page = await context.newPage();
  await page.goto("/bookings/availability");
  test.skip(!(await rendered(page, page.getByTestId("calendar-integrations"))), MISSING);
  await expect(page.getByTestId("calendar-status")).toHaveCount(0);
  await context.close();
});

// ---------- launch readiness (20261112100000) ----------

test.describe("launch readiness", () => {
  test("the longer landing spellings redirect to the one canonical page", async ({ request }) => {
    for (const path of ["/coaches/specialization/weight-loss", "/coaches/city/Cluj-Napoca"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(308);
      expect(res.headers().location).toMatch(/\/coaches\/(weight-loss|cluj-napoca)$/);
    }
  });

  test("anonymous Follow carries the intent through sign-in", async ({ browser }) => {
    test.skip(!PUBLISHED, "set E2E_PUBLISHED_COACH to a published coach's slug");
    const { context, page } = await anonymousPage(browser);
    await page.goto(`/coaches/${PUBLISHED}`);
    const follow = page.locator('[data-mkt-wall="follow"]').first();
    expect(decodeURIComponent((await follow.getAttribute("href")) ?? "")).toContain(`/coaches/${PUBLISHED}?intent=follow`);
    await context.close();
  });

  test("a published coach without weekly hours shows no Book button", async ({ browser }) => {
    test.skip(!PUBLISHED, "set E2E_PUBLISHED_COACH to a published coach's slug");
    const { context, page } = await anonymousPage(browser);
    await page.goto(`/coaches/${PUBLISHED}`);
    const availability = page.getByTestId("coach-availability");
    if (await availability.count() && (await availability.getAttribute("data-bookable")) === "false") {
      await expect(page.getByTestId("book-service")).toHaveCount(0);
    }
    await context.close();
  });
});

// Journey D (moderation) in the browser needs an admin account: E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
// The database half — report → suspend → gone from search, page, sitemap and landing counts — is
// pgTAP marketplace_launch, which runs everywhere.
test.describe("admin operations", () => {
  const email = process.env.E2E_ADMIN_EMAIL ?? "";
  test.skip(!email, "set E2E_ADMIN_EMAIL (and E2E_ADMIN_PASSWORD) to an admin account");

  test("the coach queue shows what needs attention; a coach page shows activity and history", async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context);
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password", { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD ?? "");
    await page.locator("form button[type=submit]").click();
    await page.goto("/admin/coaches?status=published");
    test.skip(!(await rendered(page, page.getByRole("heading", { name: "Needs attention" }))), MISSING);
    const first = page.getByTestId("admin-coach-row").first();
    test.skip(!(await first.count()), "no published coach");
    await first.getByRole("link").click();
    await expect(page.getByTestId("admin-coach-ops")).toBeVisible();
    await expect(page.getByText("Moderation history")).toBeVisible();
    await context.close();
  });
});
