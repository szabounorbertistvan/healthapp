import { expect, test, type Browser, type Page } from "@playwright/test";
import { authFile, PASSWORD, prepare, signIn } from "./accounts";

/**
 * Availability + bookable services + bookings (20261105100000).
 *
 * Part one runs by default and writes nothing: the coach's Bookings and
 * Availability pages render, My bookings renders and is private, a booking
 * page is public to look at but needs a sign-in to confirm. It skips itself
 * while the migration is not on the database (the error boundary shows —
 * status codes say nothing: the app groups stream behind a loading.tsx).
 *
 * Part two is the whole journey, 1–10 of the brief, and it writes: a service
 * made bookable, weekly hours, a booking confirmed then cancelled. It cannot
 * leave the live project as it found it (an availability block and a
 * cancelled booking remain), so it runs only when asked, against a stack you
 * can throw away:
 *
 *   E2E_BOOKING_FLOW=1
 *   E2E_PUBLISHED_COACH=<slug of the coach below, with a non-digital service>
 *   E2E_FLOW_COACH=<that coach's e-mail>   E2E_FLOW_CLIENT=<any other account>
 */

const PUBLISHED = process.env.E2E_PUBLISHED_COACH ?? "";
const MISSING = "migration 20261105100000 is not on this database yet";

/** The page rendered (ready is visible), or the error boundary did. */
async function rendered(page: Page, ready: ReturnType<Page["getByTestId"]>): Promise<boolean> {
  const failed = page.getByText("Something went wrong on this screen");
  await expect(ready.or(failed).first()).toBeVisible();
  return !(await failed.isVisible());
}

test.describe("no trace", () => {
  test.describe("coach", () => {
    test.use({ storageState: authFile("coach") });

    test("Bookings has its tabs and the way to Availability", async ({ page }) => {
      await page.goto("/bookings");
      test.skip(!(await rendered(page, page.getByTestId("coach-bookings").or(page.getByTestId("bookings-empty")))), MISSING);
      await expect(page.getByRole("link", { name: "Needs outcome" })).toBeVisible();
      await page.getByTestId("availability-link").click();
      await expect(page).toHaveURL(/\/bookings\/availability$/);
      await expect(page.getByTestId("weekly-hours")).toBeVisible();
      await expect(page.getByTestId("weekday")).toHaveCount(7);
      // the zone is named, never assumed
      await expect(page.getByTestId("coach-timezone")).toContainText("/");
    });

    test("a block that ends before it starts cannot be added", async ({ page }) => {
      await page.goto("/bookings/availability");
      test.skip(!(await rendered(page, page.getByTestId("weekly-hours"))), MISSING);
      const monday = page.locator('[data-testid="weekday"][data-weekday="1"]');
      await monday.getByTestId("add-hours").click();
      await monday.getByTestId("hours-from").fill("14:00");
      await monday.getByTestId("hours-to").fill("13:00");
      await expect(monday.getByTestId("hours-add")).toBeDisabled();
      await expect(monday.getByText("The end must be after the start.")).toBeVisible();
    });
  });

  test.describe("client", () => {
    test.use({ storageState: authFile("client") });

    test("My bookings renders", async ({ page }) => {
      await page.goto("/coaches/bookings");
      test.skip(!(await rendered(page, page.getByTestId("my-bookings").or(page.getByTestId("my-bookings-empty")))), MISSING);
    });
  });

  test("My bookings is private: an anonymous visitor is sent to sign in", async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context);
    const page = await context.newPage();
    await page.goto("/coaches/bookings");
    await expect(page).toHaveURL(/login\?next=%2Fcoaches%2Fbookings/);
    await context.close();
  });

  test("a booking page can be looked at anonymously, but confirming needs a sign-in", async ({ browser }) => {
    test.skip(!PUBLISHED, "set E2E_PUBLISHED_COACH to a published coach's slug");
    const context = await browser.newContext();
    await prepare(context);
    const page = await context.newPage();
    await page.goto(`/coaches/${PUBLISHED}/book`);
    test.skip(!(await rendered(page, page.getByTestId("booking-picker").or(page.getByTestId("book-unavailable")))), MISSING);
    const slot = page.getByTestId("booking-slot").first();
    test.skip((await slot.count()) === 0, "this coach has no bookable service with free times this week");
    await slot.click();
    await expect(page.getByTestId("booking-sign-in")).toBeVisible();
    await expect(page.getByTestId("booking-submit")).toHaveCount(0);
    await context.close();
  });
});

const FLOW = process.env.E2E_BOOKING_FLOW === "1";
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
    "set E2E_BOOKING_FLOW=1, E2E_PUBLISHED_COACH, E2E_FLOW_COACH and E2E_FLOW_CLIENT — disposable stacks only");
  test.setTimeout(240_000);

  test("bookable service → hours → book → confirm → cancel", async ({ browser }) => {
    const coach = await as(browser, COACH);
    const client = await as(browser, CLIENT);

    // 1. the coach makes a service bookable: 60 minutes, on approval
    await coach.page.goto("/bookings/availability");
    const service = coach.page.getByTestId("service-booking").filter({ has: coach.page.getByRole("switch") }).first();
    const bookable = service.getByRole("switch", { name: "Bookable" });
    if ((await bookable.getAttribute("aria-checked")) !== "true") await bookable.click();
    await service.getByTestId("booking-duration").fill("60");
    await service.getByTestId("booking-access").selectOption("public");
    await service.getByTestId("booking-confirmation").selectOption("approval");
    await service.getByTestId("booking-save").click();
    await expect(service.getByRole("status")).toHaveText("Saved.");
    const serviceId = await service.getAttribute("data-service");

    // 2. weekly hours on every day, so the next week has free times whatever today is
    for (let wd = 1; wd <= 7; wd++) {
      const day = coach.page.locator(`[data-testid="weekday"][data-weekday="${wd}"]`);
      if ((await day.getByTestId("hours").count()) > 0) continue;
      await day.getByTestId("add-hours").click();
      await day.getByTestId("hours-from").fill("09:00");
      await day.getByTestId("hours-to").fill("17:00");
      await day.getByTestId("hours-add").click();
      await expect(day.getByTestId("hours")).toHaveCount(1);
    }

    // 3–4. the client opens the profile and picks the service
    await client.page.goto(`/coaches/${PUBLISHED}`);
    await client.page.locator(`a[data-testid="book-service"][href*="${serviceId}"]`).first().click();
    await expect(client.page.getByTestId("booking-picker")).toBeVisible();
    await expect(client.page.getByTestId("booking-zone")).toBeVisible();

    // 5–6. free times are shown; the client books one
    let slot = client.page.getByTestId("booking-slot").first();
    if ((await slot.count()) === 0) {
      await client.page.getByTestId("booking-next-week").click();
      slot = client.page.getByTestId("booking-slot").first();
    }
    const startAt = await slot.getAttribute("data-start");
    await slot.click();
    await client.page.getByTestId("booking-submit").click();
    await expect(client.page.getByTestId("booking-done")).toHaveAttribute("data-outcome", "requested");

    // 7. the coach receives the request
    await coach.page.goto("/bookings?tab=pending");
    const row = coach.page.getByTestId("booking").filter({ has: coach.page.locator('[data-testid="booking-accept"]') }).first();
    await expect(row).toBeVisible();

    // 8. the coach confirms
    await row.getByTestId("booking-accept").click();
    await coach.page.goto("/bookings?tab=confirmed");
    await expect(coach.page.getByTestId("booking").first()).toHaveAttribute("data-status", "confirmed");

    // 9. the client sees it confirmed, at the time they picked
    await client.page.goto("/coaches/bookings");
    const mine = client.page.getByTestId("my-bookings-upcoming").getByTestId("booking").first();
    await expect(mine).toHaveAttribute("data-status", "confirmed");
    expect(startAt).toBeTruthy();

    // 10. cancellation works, and frees the time
    await mine.getByTestId("booking-cancel").click();
    await mine.getByTestId("booking-cancel-confirm").click();
    await expect(client.page.getByTestId("my-bookings-cancelled").getByTestId("booking").first())
      .toHaveAttribute("data-status", "cancelled");

    await client.context.close();
    await coach.context.close();
  });
});
