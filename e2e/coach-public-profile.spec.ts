import { expect, test, type Browser } from "@playwright/test";
import { authFile, prepare } from "./accounts";

/**
 * /coaches/[slug] against the live project (needs 20261021100000 there).
 *
 * The published-page tests need a published coach on live and read its slug
 * from E2E_PUBLISHED_COACH; without it they are skipped. Every write is undone
 * in the same test (a request is cancelled, a follow is taken back).
 */

const PUBLISHED = process.env.E2E_PUBLISHED_COACH ?? "";

async function anonymousPage(browser: Browser, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await prepare(context);
  return { context, page: await context.newPage() };
}

test.describe("not public", () => {
  test("an unknown slug is a 404 with a way back to discovery, never indexed", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    const response = await page.goto("/coaches/no-such-coach-e2e");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Coach not found", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle("Coach not found | Voinic");
    // ours, and the one Next adds to every not-found
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    await page.getByRole("link", { name: "Browse coaches" }).click();
    await expect(page).toHaveURL(/\/coaches$/);
    await context.close();
  });

  test.describe("a regular user", () => {
    test.use({ storageState: authFile("client") });
    test("their username is not a coach page, and they get the same not-found", async ({ page }) => {
      // the seeded client has a social profile (/people/<id>) but no coach profile
      await page.goto("/account");
      const username = await page.getByLabel("Username").inputValue().catch(() => "");
      test.skip(!username, "could not read the client's username");
      const response = await page.goto(`/coaches/${username.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByTestId("coach-not-found")).toBeVisible();
    });
  });

  test.describe("a draft", () => {
    test.use({ storageState: authFile("coach") });
    test("the seeded coach's draft is not reachable anonymously", async ({ page, browser }) => {
      await page.goto("/settings/coach-profile?step=1");
      const slugField = page.getByLabel("Profile link");
      test.skip((await slugField.count()) === 0, "the seeded coach has no draft profile");
      const slug = await slugField.inputValue();
      const { context, page: anon } = await anonymousPage(browser);
      const response = await anon.goto(`/coaches/${slug}`);
      expect(response?.status()).toBe(404);
      await context.close();
    });
  });
});

test.describe("published", () => {
  test.skip(!PUBLISHED, "set E2E_PUBLISHED_COACH to a published coach's slug");

  test("an anonymous visitor sees the page, its services and metadata — never an e-mail", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    const response = await page.goto(`/coaches/${PUBLISHED}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
    await expect(page.getByTestId("coach-public-services").locator("li").first()).toBeVisible();
    expect(await page.content()).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    // "why train with" is built from real facts only, and ends in the one real next step
    await expect(page.getByTestId("coach-why")).toBeVisible();
    await expect(page.getByTestId("coach-why")).not.toContainText(/rating|★|% of clients/i);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "profile");
    await expect(page).toHaveTitle(/\| Voinic$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/coaches/${PUBLISHED}$`));
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Voinic/);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}");
    // one @graph since the breadcrumb joined it: ProfilePage is one of its nodes
    const types = (ld["@graph"] ?? [ld]).map((node: { "@type"?: string }) => node["@type"]);
    expect(types).toContain("ProfilePage");
    // Start coaching and Follow lead to sign-in
    await expect(page.getByRole("link", { name: "Contact coach" }).first()).toHaveAttribute("href", /\/login\?next=/);
    await expect(page.getByRole("link", { name: "Follow" }).first()).toHaveAttribute("href", /\/login\?next=/);
    await context.close();
  });

  // 20261101100000: the badge follows the coach-level decision only. The seeded
  // test coach is never verified, so neither its page nor its card may show it,
  // and its credentials read as provided by the coach.
  test("an unverified coach shows no Voinic Verified badge, anywhere", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser);
    await page.goto(`/coaches/${PUBLISHED}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("voinic-verified")).toHaveCount(0);
    await expect(page.locator('[data-testid="public-credential"][data-verified="true"]')).toHaveCount(0);
    await page.goto(`/coaches?all=1&q=${PUBLISHED}`);
    const card = page.getByTestId("coach-card").filter({ has: page.locator(`a[href="/coaches/${PUBLISHED}"]`) });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("voinic-verified")).toHaveCount(0);
    await context.close();
  });

  test("on a phone the page is one column with a sticky Start coaching bar", async ({ browser }) => {
    const { context, page } = await anonymousPage(browser, { width: 390, height: 844 });
    await page.goto(`/coaches/${PUBLISHED}`);
    const bar = page.locator("body > div.fixed").filter({ has: page.getByRole("link", { name: "Contact coach" }) });
    await expect(bar).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await context.close();
  });

  test.describe("signed in as this coach's client", () => {
    test.use({ storageState: authFile("client") });

    // The seeded client's coach (Andrei) is a draft; this needs a published
    // coach who is the client's current coach — its slug in E2E_CLIENTS_COACH.
    const CLIENTS_COACH = process.env.E2E_CLIENTS_COACH ?? "";
    test("an existing client sees that they train with the coach, not Start coaching", async ({ page }) => {
      test.skip(!CLIENTS_COACH, "set E2E_CLIENTS_COACH to the published slug of the client's current coach");
      await page.goto(`/coaches/${CLIENTS_COACH}`);
      await expect(page.getByRole("link", { name: "You train with this coach" }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Contact coach" })).toHaveCount(0);
    });
  });

  test.describe("signed in as someone else", () => {
    // coach2 is not this coach's client: anyone signed in may ask
    test.use({ storageState: authFile("coach2") });

    test("the contact form asks for a message before anything is sent", async ({ page }) => {
      await page.goto(`/coaches/${PUBLISHED}`);
      const start = page.getByTestId("contact-coach").first();
      test.skip(!(await start.isVisible().catch(() => false)), "this coach is not taking requests from this account");
      await start.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByTestId("coaching-request-send").click();
      await expect(dialog.getByText("Write a short message.")).toBeVisible();
      await expect(dialog.getByTestId("coaching-request-sent")).toHaveCount(0);
      await dialog.getByRole("button", { name: "Cancel" }).click();
    });

    test("Contact coach sends one request, shows it pending, and can be cancelled", async ({ page }) => {
      await page.goto(`/coaches/${PUBLISHED}`);
      const start = page.getByRole("button", { name: "Contact coach" }).first();
      test.skip(!(await start.isVisible().catch(() => false)), "this coach is not taking requests from this account");
      try {
        await start.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await dialog.getByRole("radio").first().check();
        await dialog.getByLabel("Message", { exact: true }).fill("E2E request — please ignore");
        await dialog.getByRole("button", { name: "Send request" }).click();
        await expect(dialog.getByTestId("coaching-request-sent")).toBeVisible();
        await dialog.getByRole("button", { name: "Close" }).click();
        await expect(page.getByTestId("coaching-request-pending").first()).toBeVisible();
        // no second request: the button is gone while one is pending, and it stays so after a reload
        await page.reload();
        await expect(page.getByTestId("coaching-request-pending").first()).toBeVisible();
        await expect(page.getByRole("button", { name: "Contact coach" })).toHaveCount(0);
      } finally {
        const cancel = page.getByRole("button", { name: "Cancel request" }).first();
        if (await cancel.isVisible().catch(() => false)) {
          await cancel.click();
          await expect(page.getByTestId("coaching-request-pending")).toHaveCount(0);
        }
      }
    });

    test("Follow uses the existing follow button and can be undone", async ({ page }) => {
      await page.goto(`/coaches/${PUBLISHED}`);
      const button = () => page.locator("button[aria-pressed]").filter({ hasText: /^(Follow|Following|Follow back|Unfollow)$/ }).first();
      // following → unfollow takes a second, confirming tap (the existing FollowButton)
      const toggle = async () => {
        const was = await button().getAttribute("aria-pressed");
        await button().click();
        if (was === "true") await button().click();
        await expect(button()).toHaveAttribute("aria-pressed", was === "true" ? "false" : "true");
      };
      await expect(button()).toBeVisible();
      const before = await button().getAttribute("aria-pressed");
      try {
        await toggle();
        await page.reload();
        await expect(button()).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
      } finally {
        if ((await button().getAttribute("aria-pressed")) !== before) await toggle();
      }
    });
  });
});
