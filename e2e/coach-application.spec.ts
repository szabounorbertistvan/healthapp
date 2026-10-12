import { expect, test } from "@playwright/test";
import { authFile, prepare } from "./accounts";

/**
 * Coach applications (20261118100000). Read-only: nothing is uploaded,
 * submitted or decided — the decisions and the document rules are covered by
 * supabase/tests/coach_application_review.test.sql. What is checked here is
 * the app's side of the gates: the queue is admin-only, a document link
 * answers 404 to anyone the database does not show the row to, and the
 * coach's profile page carries the application card once the migration is
 * on the project.
 */

const QUEUE = "/admin/coach-applications";
// a well-formed id no document has
const NO_DOC = "/api/coach-documents/00000000-0000-4000-8000-000000000000";

test.describe("anonymous", () => {
  test("the queue sends a visitor to sign in", async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context);
    const page = await context.newPage();
    await page.goto(QUEUE);
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
  test("a document link gives nothing away", async ({ browser }) => {
    const context = await browser.newContext();
    const res = await context.request.get(NO_DOC, { maxRedirects: 0 });
    expect([302, 303, 307, 401, 404]).toContain(res.status());
    expect(res.headers()["content-type"] ?? "").not.toMatch(/pdf|image/);
    await context.close();
  });
});

test.describe("client", () => {
  test.use({ storageState: authFile("client") });
  test("is sent away from the queue", async ({ page }) => {
    await page.goto(QUEUE);
    await expect(page).not.toHaveURL(new RegExp(QUEUE));
  });
  test("a document id that is not theirs is a 404", async ({ request }) => {
    const res = await request.get(NO_DOC);
    expect(res.status()).toBe(404);
    expect(res.headers()["cache-control"]).toContain("no-store");
  });
  test("a malformed id is a 404 too", async ({ request }) => {
    expect((await request.get("/api/coach-documents/not-an-id")).status()).toBe(404);
  });
});

test.describe("coach", () => {
  test.use({ storageState: authFile("coach") });

  test("is sent away from the queue and the review page", async ({ page }) => {
    await page.goto(QUEUE);
    await expect(page).not.toHaveURL(new RegExp(QUEUE));
    await page.goto("/admin/coaches");
    await expect(page).not.toHaveURL(/\/admin\/coaches/);
  });

  test("a document id that is not theirs is a 404", async ({ request }) => {
    expect((await request.get(NO_DOC)).status()).toBe(404);
  });

  test("the profile page shows the application, with private documents", async ({ page }) => {
    await page.goto("/settings/coach-profile");
    const card = page.getByTestId("coach-application");
    const noProfile = page.getByRole("button", { name: "Become a coach" });
    await expect(card.or(noProfile).or(page.getByRole("heading", { level: 1 })).first()).toBeVisible();
    test.skip(!(await card.count()), "the coach has no profile, or 20261118100000 is not applied to this project");
    await expect(card.getByTestId("coach-application-state")).toBeVisible();
    await expect(card.getByText("only you and Voinic's reviewers can open them")).toBeVisible();
    // never a "certified" claim
    await expect(card.getByText(/certified by voinic/i)).toHaveCount(0);
    // every document opens through the app's own gate, never a storage URL
    for (const href of await card.locator("a[href*='coach-documents'], a[href*='cloudinary']").evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
      expect(href).toMatch(/^\/api\/coach-documents\/[0-9a-f-]{36}$/);
    }
    const state = await card.getAttribute("data-state");
    if (state === "pending_review" || state === "suspended") await expect(card.getByTestId("coach-documents-locked")).toBeVisible();
  });

  test("the public pages never carry document links", async ({ page }) => {
    await page.goto("/coaches?all=1");
    await expect(page.locator("a[href*='coach-documents'], a[href*='coach-docs']")).toHaveCount(0);
  });
});
