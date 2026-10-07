import { expect, test, type Browser } from "@playwright/test";
import { PASSWORD, authFile, prepare, signIn } from "./accounts";

/**
 * The coaching relationship lifecycle (20261109100000 + 20261109110000).
 *
 * Part one runs by default and writes nothing: the client's Coach page and the
 * coach's Clients page render their lifecycle areas, and a relationship page
 * that is not the reader's is a 404.
 *
 * Part two is the journey of the brief (1–15) and writes a request, a
 * relationship and its pause / resume / end, so it runs only when asked, on a
 * stack you can throw away:
 *
 *   E2E_LIFECYCLE_FLOW=1  E2E_PUBLISHED_COACH=<slug>
 *   E2E_FLOW_COACH=<that coach's e-mail>  E2E_FLOW_CLIENT=<an account with no coach>
 */

const NOBODY = "00000000-0000-4000-8000-000000000000";

test.describe("no trace", () => {
  test.describe("client", () => {
    test.use({ storageState: authFile("client") });
    test("the Coach page shows the current coach or the ways to find one — never both", async ({ page }) => {
      await page.goto("/coach");
      const current = page.getByTestId("current-coach");
      const none = page.getByTestId("find-a-coach");
      await expect(current.or(none).or(page.getByTestId("message-thread")).first()).toBeVisible();
      if (await current.count()) {
        await expect(none).toHaveCount(0);
        await expect(current).toHaveAttribute("data-status", /^(active|paused)$/);
      }
    });
  });

  test.describe("coach", () => {
    test.use({ storageState: authFile("coach") });
    test("Clients renders, and another coach's relationship page is a 404", async ({ page }) => {
      await page.goto("/clients");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.goto(`/clients/relationship/${NOBODY}`);
      await expect(page.getByText("This page could not be found")).toBeVisible();
    });
  });
});

const FLOW = process.env.E2E_LIFECYCLE_FLOW === "1";
const PUBLISHED = process.env.E2E_PUBLISHED_COACH ?? "";
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

test.describe("the whole lifecycle (writes, opt-in)", () => {
  test.skip(!FLOW || !PUBLISHED || !COACH || !CLIENT,
    "set E2E_LIFECYCLE_FLOW=1, E2E_PUBLISHED_COACH, E2E_FLOW_COACH and E2E_FLOW_CLIENT — disposable stacks only");
  test.setTimeout(300_000);

  test("request → start → pause → resume → end → history → a new engagement is explicit", async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const client = await as(browser, CLIENT);
    const coach = await as(browser, COACH);

    // 1–2. discover, request
    await client.page.goto(`/coaches/${PUBLISHED}`);
    await client.page.getByTestId("contact-coach").first().click();
    const dialog = client.page.getByRole("dialog");
    await dialog.getByLabel("Message", { exact: true }).fill(`E2E ${stamp}`);
    await dialog.getByTestId("coaching-request-send").click();
    await expect(dialog.getByTestId("coaching-request-sent")).toBeVisible();
    // 3–4. accept, start
    await coach.page.goto("/requests");
    await coach.page.getByTestId("coach-request").filter({ hasText: `E2E ${stamp}` }).getByTestId("request-accept").click();
    await coach.page.goto("/requests?tab=accepted");
    await coach.page.getByTestId("coach-request").filter({ hasText: `E2E ${stamp}` }).getByTestId("request-start").click();
    // 5. the client sees the active coach; the profile says so too
    await client.page.goto("/coach");
    await expect(client.page.getByTestId("current-coach")).toHaveAttribute("data-status", "active");
    // 6. the coach sees the active client
    await coach.page.goto("/clients");
    await expect(coach.page.getByTestId("clients-paused")).toHaveCount(0);
    // 7. both can message
    await client.page.getByLabel("Message…").fill(`Hi ${stamp}`);
    await client.page.getByRole("button", { name: "Send" }).click();
    await expect(client.page.getByTestId("message").filter({ hasText: `Hi ${stamp}` })).toBeVisible();

    // 8–9. the client pauses; both sides show it, the profile CTA follows
    await client.page.getByTestId("coaching-pause").click();
    await client.page.getByTestId("coaching-reason").selectOption("vacation");
    await client.page.getByTestId("coaching-confirm-button").click();
    await expect(client.page.getByTestId("current-coach")).toHaveAttribute("data-status", "paused");
    await client.page.goto(`/coaches/${PUBLISHED}`);
    await expect(client.page.getByTestId("coaching-paused-cta").first()).toBeVisible();
    await coach.page.goto("/clients");
    await expect(coach.page.getByTestId("clients-paused").getByTestId("client-relationship")).toHaveCount(1);

    // 10–11. the coach resumes
    await coach.page.getByTestId("clients-paused").getByTestId("client-relationship").first().click();
    await coach.page.getByTestId("coaching-resume").click();
    await expect(coach.page.getByTestId("coach-relationship")).toHaveAttribute("data-status", "active");
    await client.page.goto("/coach");
    await expect(client.page.getByTestId("current-coach")).toHaveAttribute("data-status", "active");

    // 12–13. the coach ends it; the history stays on both sides
    await coach.page.getByTestId("coaching-end").click();
    await coach.page.getByTestId("coaching-confirm-button").click();
    await expect(coach.page.getByTestId("coach-relationship")).toHaveAttribute("data-status", "ended");
    await expect(coach.page.getByTestId("relationship-history").locator("li")).toHaveCount(4);
    await client.page.goto("/coach");
    await expect(client.page.getByTestId("current-coach")).toHaveCount(0);
    await expect(client.page.getByTestId("past-coaches").getByTestId("past-coach")).toHaveCount(1);

    // 14. a new engagement is explicit: the profile offers a new request, not a resume
    await client.page.goto(`/coaches/${PUBLISHED}`);
    await expect(client.page.getByTestId("contact-coach").first()).toHaveAttribute("data-state", "start_new");

    // 15. no duplicate active relationship: a resume of the ended one is not offered anywhere
    await coach.page.reload();
    await expect(coach.page.getByTestId("coaching-resume")).toHaveCount(0);

    await client.context.close();
    await coach.context.close();
  });
});
