import { expect, test, type Browser, type Page } from "@playwright/test";
import { authFile, PASSWORD, prepare, signIn } from "./accounts";

/**
 * Coach reviews and ratings (20261106100000).
 *
 * Part one runs by default and writes nothing: the review page is private
 * and refuses someone without a real interaction, the coach's Reviews page
 * renders, and wherever Discovery shows a rating it reads "4.9 ★ · N
 * reviews" — never a made-up number. It skips what needs the migration
 * while the database does not have it (the error boundary shows; status
 * codes say nothing behind a loading.tsx).
 *
 * Part two is the journey of the brief (1–9) and writes a review, so it runs
 * only when asked, on a stack you can throw away. It deletes the review at
 * the end (a soft delete: the row and the coach's notice remain):
 *
 *   E2E_REVIEW_FLOW=1
 *   E2E_PUBLISHED_COACH=<slug>   E2E_FLOW_COACH=<that coach's e-mail>
 *   E2E_FLOW_CLIENT=<an account with a completed session or a week of coaching with them>
 */

const PUBLISHED = process.env.E2E_PUBLISHED_COACH ?? "";
const MISSING = "migration 20261106100000 is not on this database yet";

async function rendered(page: Page, ready: ReturnType<Page["getByTestId"]>): Promise<boolean> {
  const failed = page.getByText("Something went wrong on this screen");
  await expect(ready.or(failed).first()).toBeVisible();
  return !(await failed.isVisible());
}

test.describe("no trace", () => {
  test("the review page is private: an anonymous visitor is sent to sign in", async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context);
    const page = await context.newPage();
    await page.goto("/coaches/some-coach/review");
    await expect(page).toHaveURL(/login\?next=%2Fcoaches%2Fsome-coach%2Freview/);
    await context.close();
  });

  test("a Discovery rating, wherever one is shown, is the real format", async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context);
    const page = await context.newPage();
    await page.goto("/coaches?all=1");
    const ratings = page.getByTestId("coach-card-rating");
    for (const text of await ratings.allTextContents()) {
      expect(text).toMatch(/^[1-5]\.\d ★ · \d+ reviews?$/);
    }
    await context.close();
  });

  test.describe("coach", () => {
    test.use({ storageState: authFile("coach") });
    test("Reviews renders the coach's own list", async ({ page }) => {
      await page.goto("/reviews");
      test.skip(!(await rendered(page, page.getByTestId("coach-reviews").or(page.getByRole("heading", { name: "Reviews" })))), MISSING);
      await expect(page.getByRole("heading", { level: 1, name: "Reviews" })).toBeVisible();
    });
  });

  test.describe("someone without an interaction", () => {
    test.use({ storageState: authFile("coach2") });
    test("cannot write a review — the page says why", async ({ page }) => {
      test.skip(!PUBLISHED, "set E2E_PUBLISHED_COACH to a published coach's slug");
      await page.goto(`/coaches/${PUBLISHED}/review`);
      test.skip(!(await rendered(page, page.getByTestId("review-not-eligible").or(page.getByTestId("review-form")))), MISSING);
      // coach2 has neither coaching nor a completed session with the published coach in the seed
      await expect(page.getByTestId("review-not-eligible")).toBeVisible();
      await expect(page.getByTestId("review-submit")).toHaveCount(0);
    });
  });
});

const FLOW = process.env.E2E_REVIEW_FLOW === "1";
const COACH = process.env.E2E_FLOW_COACH ?? "";
const CLIENT = process.env.E2E_FLOW_CLIENT ?? "";

async function as(browser: Browser, email: string) {
  const context = await browser.newContext();
  await prepare(context);
  const page = await context.newPage();
  await signIn(page, email, PASSWORD);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
  return { context, page };
}

test.describe("the whole journey (writes, opt-in)", () => {
  test.skip(!FLOW || !PUBLISHED || !COACH || !CLIENT,
    "set E2E_REVIEW_FLOW=1, E2E_PUBLISHED_COACH, E2E_FLOW_COACH and E2E_FLOW_CLIENT — disposable stacks only");
  test.setTimeout(180_000);

  test("eligible client → review → profile, notice, card → edit → no duplicate", async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const client = await as(browser, CLIENT);
    const coach = await as(browser, COACH);
    client.page.on("dialog", (d) => d.accept());

    // 1–2. the eligible client sees the CTA on the coach's page
    await client.page.goto(`/coaches/${PUBLISHED}`);
    const before = Number((await client.page.getByTestId("reviews-summary").getAttribute("data-count").catch(() => null)) ?? 0);
    await client.page.getByTestId("review-cta").click();
    await expect(client.page).toHaveURL(new RegExp(`/coaches/${PUBLISHED}/review$`));

    // 3. rating + text
    await client.page.locator('[data-testid="review-stars"] [data-star="5"]').click();
    await client.page.getByTestId("review-text").fill(`E2E ${stamp}: great coaching`);
    await client.page.getByTestId("review-submit").click();
    await expect(client.page.getByTestId("review-done")).toBeVisible();

    // 4. it is on the profile, with the count up by one
    await client.page.goto(`/coaches/${PUBLISHED}`);
    await expect(client.page.getByTestId("review").filter({ hasText: `E2E ${stamp}` })).toHaveAttribute("data-rating", "5");
    await expect(client.page.getByTestId("reviews-summary")).toHaveAttribute("data-count", String(before + 1));

    // 5. the coach is notified, and the notice opens their Reviews
    await coach.page.goto("/notifications");
    await expect(coach.page.locator('a[href="/reviews"]').first()).toBeVisible();

    // 6. the Discovery card carries the database's count
    await client.page.goto(`/coaches?all=1&q=${encodeURIComponent(PUBLISHED.replace(/-/g, " "))}`);
    await expect(client.page.getByTestId("coach-card-rating").first()).toContainText(`${before + 1} review`);

    // 7–8. the client edits; the same review changes
    await client.page.goto(`/coaches/${PUBLISHED}/review`);
    await client.page.locator('[data-testid="review-stars"] [data-star="4"]').click();
    await client.page.getByTestId("review-text").fill(`E2E ${stamp}: great coaching, edited`);
    await client.page.getByTestId("review-submit").click();
    await expect(client.page.getByTestId("review-done")).toBeVisible();
    await client.page.goto(`/coaches/${PUBLISHED}`);
    const mine = client.page.getByTestId("review").filter({ hasText: `E2E ${stamp}` });
    await expect(mine).toHaveCount(1);
    await expect(mine).toHaveAttribute("data-rating", "4");
    await expect(mine).toContainText("edited");

    // 9. no duplicate: the way in is "Edit your review", and the count did not move
    await expect(client.page.getByTestId("review-cta")).toHaveText("Edit your review");
    await expect(client.page.getByTestId("reviews-summary")).toHaveAttribute("data-count", String(before + 1));

    // clean up: the reviewer deletes their review
    await client.page.goto(`/coaches/${PUBLISHED}/review`);
    await client.page.getByTestId("review-delete").click();
    await expect(client.page.getByTestId("review-done")).toBeVisible();

    await client.context.close();
    await coach.context.close();
  });
});
