import { expect, test } from "./fixtures";
import { prepare } from "../e2e/accounts";
import { ACCOUNTS, DRAFT_COACH, PASSWORD, PUBLISHED_COACH, USERNAMES } from "./accounts";
import { remove, rows, userId } from "./backend";
import { as, expectNoCrash } from "./helpers";

// Coach Discovery against the seeded coaches: e2e-coach-alpha published and
// accepting, e2e-coach-beta a draft. The public pages read anon-granted RPCs
// only; everything here goes through the real middleware, PostgREST and RLS.

test.describe("a visitor", () => {
  test.beforeEach(async ({ context }) => prepare(context));

  test("finds the published coach in the directory, by search and by filter — never the draft", async ({ page }) => {
    await page.goto("/coaches?all=1");
    await expect(page.getByRole("link", { name: new RegExp(USERNAMES.coachA) }).first()).toBeVisible();
    await expect(page.getByText("Draft coach, never published")).toHaveCount(0);

    await page.getByRole("searchbox", { name: "Search coaches" }).fill("E2E strength");
    await page.getByRole("searchbox", { name: "Search coaches" }).press("Enter");
    await expect(page).toHaveURL(/[?&]q=E2E\+strength/);
    await expect(page.getByRole("link", { name: new RegExp(USERNAMES.coachA) }).first()).toBeVisible();

    await page.goto("/coaches?q=Draft+coach+never+published");
    await expect(page.getByRole("link", { name: new RegExp(USERNAMES.coachB) })).toHaveCount(0);

    await page.goto("/coaches?all=1");
    await page.getByRole("combobox", { name: "City" }).selectOption({ label: "Cluj-Napoca (1)" });
    await expect(page).toHaveURL(/city=/);
    await page.reload();
    await expect(page.getByRole("link", { name: new RegExp(USERNAMES.coachA) }).first()).toBeVisible();
  });

  test("opens the public profile; its HTML carries no e-mail and no account id", async ({ page }) => {
    const res = await page.goto(`/coaches/${PUBLISHED_COACH}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: USERNAMES.coachA })).toBeVisible();
    const html = await page.content();
    const coachId = await userId(USERNAMES.coachA);
    expect(html).not.toContain("@voinic.test");
    expect(html, "the coach's user id is for signed-in readers only").not.toContain(coachId);
  });

  test("a draft profile and an unknown slug are both a plain 404", async ({ page }) => {
    const draft = await page.goto(`/coaches/${DRAFT_COACH}`);
    expect(draft?.status()).toBe(404);
    // the directory's own not-found page: nothing of the draft on it
    await expect(page.getByText("Draft coach, never published")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: USERNAMES.coachB })).toHaveCount(0);
    await expectNoCrash(page);
    const unknown = await page.goto("/coaches/no-such-coach-e2e");
    expect(unknown?.status()).toBe(404);
  });

  test("Contact asks the visitor to sign in first, and comes back to the same coach", async ({ page }) => {
    await page.goto(`/coaches/${PUBLISHED_COACH}`);
    await page.getByTestId("contact-coach-signin").first().click();
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get("next") ?? "")).toContain(`/coaches/${PUBLISHED_COACH}`);
  });
});

test.describe("what search engines and the landing page see", () => {
  test.beforeEach(async ({ context }) => prepare(context));

  test("the landing page's discovery section lists the published coach, never the draft", async ({ page }) => {
    await page.goto("/");
    const section = page.getByTestId("landing-coaches");
    await expect(section).toBeVisible();
    await expect(section.getByTestId("landing-coach-card").filter({ hasText: USERNAMES.coachA }).first()).toBeVisible();
    await expect(section.getByText(USERNAMES.coachB)).toHaveCount(0);
  });

  test("robots.txt keeps crawlers out of the app; the sitemap lists no draft", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const txt = await robots.text();
    expect(txt).toMatch(/Allow: \/coaches/);
    for (const path of ["/dashboard", "/today", "/admin"]) expect(txt).toContain(`Disallow: ${path}`);
    expect(txt).toContain("Sitemap: ");

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain("<urlset");
    expect(xml).toContain("/coaches</loc>");
    expect(xml).not.toContain(DRAFT_COACH);
  });

  test("the coach page carries one canonical URL, honest robots and JSON-LD without private fields", async ({ page }) => {
    await page.goto(`/coaches/${PUBLISHED_COACH}?utm_source=e2e`);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical && new URL(canonical).pathname).toBe(`/coaches/${PUBLISHED_COACH}`);
    // the seeded coach has no photo: published, but below the indexing bar (coachIndexable)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.length).toBeGreaterThan(0);
    const coachId = await userId(USERNAMES.coachA);
    for (const block of ld) {
      expect(() => JSON.parse(block)).not.toThrow();
      expect(block).not.toContain("@voinic.test");
      expect(block).not.toContain(coachId);
    }
  });

  test("a draft coach page and an unknown slug are noindex", async ({ page }) => {
    for (const path of [`/coaches/${DRAFT_COACH}`, "/coaches/no-such-coach-e2e"]) {
      await page.goto(path);
      // a 404 carries the page's own robots tag and Next's: every one must say noindex
      const robots = await page.locator('meta[name="robots"]').evaluateAll((m) => m.map((e) => e.getAttribute("content") ?? ""));
      expect(robots.length, path).toBeGreaterThan(0);
      for (const content of robots) expect(content, path).toMatch(/noindex/);
    }
  });
});

test.describe("Save, signed out", () => {
  test.beforeEach(async ({ context }) => prepare(context));
  test.afterEach(async () => {
    await remove("coach_saves", `user_id=eq.${await userId(USERNAMES.clientC)}`);
  });

  test("Save → sign in → back on the same coach, saved exactly once", async ({ page }) => {
    const client = await userId(USERNAMES.clientC);
    await remove("coach_saves", `user_id=eq.${client}`);
    await page.goto(`/coaches/${PUBLISHED_COACH}`);
    await page.getByTestId("save-coach").first().click();
    await expect(page).toHaveURL(/\/login\?/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get("next") ?? "")).toContain(`/coaches/${PUBLISHED_COACH}`);
    expect(await rows("coach_saves", `user_id=eq.${client}&select=coach_profile_id`), "nothing is saved before signing in").toHaveLength(0);

    await page.getByPlaceholder("Email").fill(ACCOUNTS.clientC);
    await page.getByPlaceholder("Password", { exact: true }).fill(PASSWORD);
    await page.locator("form button[type=submit]").click();
    // the intent is consumed and dropped from the URL, so a reload cannot repeat it
    await expect(page).toHaveURL(new RegExp(`/coaches/${PUBLISHED_COACH}$`), { timeout: 30_000 });
    await expect.poll(async () => (await rows("coach_saves", `user_id=eq.${client}&select=coach_profile_id`)).length).toBe(1);
    // and the button says so without a reload (it used to keep its signed-out "Save")
    await expect(page.getByTestId("save-coach").first()).toHaveAttribute("data-saved", "true");
    await page.reload();
    await expect(page.getByTestId("save-coach").first()).toHaveAttribute("data-saved", "true");
    expect(await rows("coach_saves", `user_id=eq.${client}&select=coach_profile_id`)).toHaveLength(1);
  });
});

test.describe("a client asking for coaching", () => {
  // client C has no coach and owns every request row this spec makes
  test.afterEach(async () => {
    await remove("coaching_requests", `client_id=eq.${await userId(USERNAMES.clientC)}`);
  });

  test("request → shown as pending; a second tab cannot file a duplicate; cancel → gone from pending", async ({ browser }) => {
    const client = await userId(USERNAMES.clientC);
    const tab1 = await as(browser, "clientC");
    const tab2 = await as(browser, "clientC");
    try {
      // both tabs open the profile before anything is sent: tab 2 is the stale one
      await tab1.page.goto(`/coaches/${PUBLISHED_COACH}`);
      await tab2.page.goto(`/coaches/${PUBLISHED_COACH}`);

      await tab1.page.getByTestId("contact-coach").first().click();
      const dialog = tab1.page.getByRole("dialog");
      await dialog.getByLabel("Message", { exact: true }).fill("E2E request from client C");
      await dialog.getByTestId("coaching-request-send").click();
      await expect(dialog.getByTestId("coaching-request-sent")).toBeVisible();
      expect(await rows("coaching_requests", `client_id=eq.${client}&status=eq.pending&select=id`)).toHaveLength(1);

      // the stale tab still offers Contact; sending again must be refused in words, not crash
      await tab2.page.getByTestId("contact-coach").first().click();
      const stale = tab2.page.getByRole("dialog");
      await stale.getByLabel("Message", { exact: true }).fill("E2E duplicate");
      await stale.getByTestId("coaching-request-send").click();
      await expect(stale.getByTestId("coaching-request-sent")).toHaveCount(0);
      await expect(stale.getByRole("alert").or(stale.locator("[role=status]")).first()).toBeVisible();
      await expectNoCrash(tab2.page);
      expect(await rows("coaching_requests", `client_id=eq.${client}&select=id`), "still exactly one request").toHaveLength(1);

      // after a refresh the profile says pending instead of offering Contact
      await tab1.page.reload();
      await expect(tab1.page.getByTestId("coaching-request-pending").first()).toBeVisible();

      // cancel from My requests
      await tab1.page.goto("/coaches/requests");
      const mine = tab1.page.getByTestId("my-request").filter({ hasText: "E2E request from client C" });
      await expect(mine).toHaveAttribute("data-status", "pending");
      await mine.getByTestId("my-request-cancel").click();
      await expect(mine).toHaveAttribute("data-status", "cancelled");
      const [row] = await rows<{ status: string }>("coaching_requests", `client_id=eq.${client}&select=status`);
      expect(row?.status).toBe("cancelled");
      await tab1.page.reload();
      await expect(tab1.page.getByTestId("my-request").filter({ hasText: "E2E request from client C" })).toHaveAttribute("data-status", "cancelled");
    } finally {
      await tab1.close();
      await tab2.close();
    }
  });
});
