import { expect, test, type Browser, type Page, type Request } from "@playwright/test";
import { PASSWORD, authFile, prepare, signIn } from "./accounts";

/**
 * Marketplace trust, ranking and analytics (20261110100000 – 20261110130000).
 *
 * Part one runs by default and writes nothing that matters: the directory
 * and coach pages send their anonymous view through marketplace_track() and
 * set no cookie or storage of their own; the privacy policy says so; the
 * admin pages are closed to everyone else; the coach's marketplace renders.
 * (Against a database without the migrations the beacon answers 404 and the
 * pages render all the same — that is checked too.)
 *
 * Part two needs a published coach (E2E_PUBLISHED_COACH) — the page-level
 * checks — and part three is the brief's journey (1–12). It creates an
 * account, a request, a relationship and a booking, so it runs only when
 * asked, on a stack you can throw away, with e-mail confirmation off:
 *
 *   E2E_MARKETPLACE_FLOW=1  E2E_PUBLISHED_COACH=<slug>  E2E_FLOW_COACH=<that coach's e-mail>
 *   E2E_FLOW_ADMIN=<an admin's e-mail>
 *
 * Steps 9–10 (a completed session, then a review) need time to pass — a
 * session completes after it ends, a review needs a completed session or a
 * week of coaching — so the journey asserts the booking request and leaves
 * completion and review to the pgTAP suite (marketplace_analytics), which
 * sets the times directly.
 */

const PUBLISHED = process.env.E2E_PUBLISHED_COACH ?? "";

function trackCall(req: Request): Record<string, unknown> | null {
  if (!req.url().includes("/rest/v1/rpc/marketplace_track") || req.method() !== "POST") return null;
  try {
    return req.postDataJSON() as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function ownStorage(page: Page) {
  return page.evaluate(() => {
    const keys: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i) ?? "");
    } catch {}
    return { local: keys, session: (() => { try { return sessionStorage.length; } catch { return 0; } })() };
  });
}

test.describe("anonymous measurement", () => {
  test.beforeEach(async ({ context }) => {
    await prepare(context);
  });

  test("the directory sends one anonymous view and stores nothing on the device", async ({ page, context }) => {
    const sent = page.waitForRequest((r) => trackCall(r)?.p_event === "directory_view");
    await page.goto("/coaches?city=cluj-napoca");
    const body = trackCall(await sent)!;
    expect(body.p_city).toBe("cluj-napoca");
    // only what prepare() set: the locale cookie and the cookie choice (essential only)
    const cookies = (await context.cookies()).map((c) => c.name).filter((n) => !n.startsWith("sb-"));
    expect(cookies).toEqual(["bg-locale"]);
    const storage = await ownStorage(page);
    expect(storage.local).toEqual(["bg-analytics-consent-v1"]);
    expect(storage.session).toBe(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the privacy policy describes it", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "Coach directory measurement" })).toBeVisible();
  });
});

test.describe("admin pages are admin-only", () => {
  test.use({ storageState: authFile("client") });
  test("a client is sent away from reports and marketplace analytics", async ({ page }) => {
    await page.goto("/admin/reports");
    await expect(page).not.toHaveURL(/\/admin\/reports/);
    await page.goto("/admin/marketplace");
    await expect(page).not.toHaveURL(/\/admin\/marketplace/);
  });
});

test.describe("the coach's marketplace", () => {
  test.use({ storageState: authFile("coach") });
  test("renders, with performance only when there is a public profile and data", async ({ page }) => {
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const perf = page.getByTestId("marketplace-performance");
    if (await perf.count()) {
      await expect(perf.getByTestId("perf-requests")).toBeVisible();
    }
  });
});

test.describe("a published coach page", () => {
  test.skip(!PUBLISHED, "set E2E_PUBLISHED_COACH=<slug> of a published coach");

  test.describe("anonymous", () => {
    test.beforeEach(async ({ context }) => {
      await prepare(context);
    });
    test("records a profile view with its source, and carries the source into sign-up", async ({ page }) => {
      const sent = page.waitForRequest((r) => trackCall(r)?.p_event === "profile_view");
      await page.goto(`/coaches/${PUBLISHED}?utm_source=instagram&utm_medium=social`);
      const body = trackCall(await sent)!;
      expect(body.p_slug).toBe(PUBLISHED);
      expect(body.p_source).toBe("instagram");
      const signup = page.getByTestId("gate-signup");
      await expect(signup).toHaveAttribute("href", /utm_source=instagram/);
      const click = page.waitForRequest((r) => trackCall(r)?.p_event === "signup_started");
      await signup.click();
      await click;
      await expect(page).toHaveURL(/\/login\?.*mode=signup.*utm_source=instagram/);
    });
  });

  test.describe("signed in", () => {
    test.use({ storageState: authFile("client") });
    test("offers Report with the marketplace reasons — no report is sent", async ({ page }) => {
      await page.goto(`/coaches/${PUBLISHED}`);
      // the profile header: Follow, Save, then the ••• menu with Report (the reviews have their own menus below)
      await page.getByRole("button", { name: /^More options for @/ }).first().click();
      await page.getByRole("button", { name: "Report this profile" }).click();
      await expect(page.getByRole("radio", { name: "Fake qualifications or credentials" })).toBeVisible();
      await expect(page.getByRole("radio", { name: "Hate speech" })).toHaveCount(0);
      await page.keyboard.press("Escape");
    });
  });
});

// ---------------------------------------------------------------------------
// the journey (writes; opt-in)
// ---------------------------------------------------------------------------
const FLOW = process.env.E2E_MARKETPLACE_FLOW === "1";
const COACH = process.env.E2E_FLOW_COACH ?? "";
const ADMIN = process.env.E2E_FLOW_ADMIN ?? "";

async function as(browser: Browser, email: string) {
  const context = await browser.newContext();
  await prepare(context);
  const page = await context.newPage();
  await signIn(page, email, PASSWORD);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
  return { context, page };
}

test.describe("the marketplace journey (writes, opt-in)", () => {
  test.skip(!FLOW || !PUBLISHED || !COACH || !ADMIN,
    "set E2E_MARKETPLACE_FLOW=1, E2E_PUBLISHED_COACH, E2E_FLOW_COACH and E2E_FLOW_ADMIN — disposable stacks only");
  test.setTimeout(300_000);

  test("anonymous visit → sign-up with attribution → request → coaching → booking → analytics", async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const visitor = await browser.newContext();
    await prepare(visitor);
    const page = await visitor.newPage();

    // 1–2. an anonymous visitor lands on the coach page from Instagram; the view is recorded
    const view = page.waitForResponse((r) => r.url().includes("/rpc/marketplace_track") && trackCall(r.request())?.p_event === "profile_view");
    await page.goto(`/coaches/${PUBLISHED}?utm_source=instagram&utm_campaign=e2e`);
    expect(await (await view).json()).toBe(true);

    // 3. the CTA
    await page.getByTestId("gate-signup").click();

    // 4–5. sign-up; the attribution travels with it
    const signupReq = page.waitForRequest((r) => r.url().includes("/auth/v1/signup"));
    await page.getByPlaceholder("Full name").fill(`E2E ${stamp}`);
    await page.getByPlaceholder("Username").fill(`e2e_${stamp}`);
    await page.getByPlaceholder("Email").fill(`e2e+${stamp}@healthapp.test`);
    await page.getByPlaceholder("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Age").fill("30");
    await page.getByRole("radio", { name: /female|male/i }).first().check().catch(() => undefined);
    await page.locator("form button[type=submit]").click();
    const meta = ((await signupReq).postDataJSON() as { data?: { signup_ref?: Record<string, string> } }).data?.signup_ref;
    expect(meta).toMatchObject({ coach: PUBLISHED, source: "instagram", campaign: "e2e" });
    await expect(page).toHaveURL(new RegExp(`/coaches/${PUBLISHED}`), { timeout: 45_000 });

    // 6. contact the coach
    await page.getByTestId("contact-coach").first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Message", { exact: true }).fill(`E2E ${stamp}`);
    await dialog.getByTestId("coaching-request-send").click();
    await expect(dialog.getByTestId("coaching-request-sent")).toBeVisible();

    // 7–8. the coach accepts and starts coaching
    const coach = await as(browser, COACH);
    await coach.page.goto("/requests");
    await coach.page.getByTestId("coach-request").filter({ hasText: `E2E ${stamp}` }).getByTestId("request-accept").click();
    await coach.page.goto("/requests?tab=accepted");
    await coach.page.getByTestId("coach-request").filter({ hasText: `E2E ${stamp}` }).getByTestId("request-start").click();
    await page.goto("/coach");
    await expect(page.getByTestId("current-coach")).toHaveAttribute("data-status", "active");

    // 9. a booking (its completion and the review need time: pgTAP covers them)
    await page.goto(`/coaches/${PUBLISHED}`);
    const book = page.getByTestId("book-service").first();
    if (await book.count()) {
      await book.click();
      await page.getByTestId("booking-slot").first().click();
      await page.getByTestId("booking-confirm").click();
    }

    // 11. the coach's analytics reflect it
    await coach.page.goto("/marketplace");
    await expect(coach.page.getByTestId("perf-views")).not.toHaveText(/\b0\b/);
    await expect(coach.page.getByTestId("perf-requests")).not.toHaveText(/^Requests0/);

    // 12. so do the admin's
    const admin = await as(browser, ADMIN);
    await admin.page.goto("/admin/marketplace");
    const funnel = admin.page.getByTestId("admin-marketplace-funnel");
    await expect(funnel.getByText("Request sent").locator("..")).not.toHaveText(/Request sent0$/);
    await expect(funnel.getByText("Sign-up completed").locator("..")).not.toHaveText(/Sign-up completed0$/);

    await visitor.close();
    await coach.context.close();
    await admin.context.close();
  });
});
