import { expect, test, type Browser, type Page } from "@playwright/test";
import { authFile, PASSWORD, prepare, signIn } from "./accounts";

/**
 * Accepted contact request → the existing conversation (20261104100000).
 *
 * Two parts. The first runs by default and leaves no trace: the inbox reads
 * through coach_conversations(), a thread that is not yours is a 404 on
 * either side, and the request pages render. It skips itself when the
 * migration is not on the database yet (the error boundary shows). Status
 * codes say nothing here: the (client) and (coach) groups stream behind a
 * loading.tsx, so a notFound() or a throw still answers 200 — the page is read.
 *
 * The second is the whole journey — request, accept, Message coach, a
 * message each way, Start coaching, the same thread after — and it CANNOT
 * undo itself: messages and a started relationship have no user-facing
 * delete. So it only runs when asked for, against a stack you can throw
 * away (a local `supabase start`, never production):
 *
 *   E2E_CONVERSATION_FLOW=1
 *   E2E_PUBLISHED_COACH=<slug of the coach below>
 *   E2E_FLOW_COACH=<that coach's e-mail>      E2E_FLOW_CLIENT=<a client with no coach>
 *   (both with the seed password, or E2E_PASSWORD)
 */

const NOBODY = "00000000-0000-4000-8000-000000000000";
const MISSING = "migration 20261104100000 is not on this database yet";

/** Next's own not-found page, which notFound() streams in. */
async function expectNotFound(page: Page) {
  await expect(page.getByText("This page could not be found")).toBeVisible();
}

/** The page rendered, or the error boundary did (the RPCs this spec needs are missing). */
async function rendered(page: Page, ready: ReturnType<Page["getByTestId"]>): Promise<boolean> {
  const failed = page.getByText("Something went wrong on this screen");
  await expect(ready.or(failed).first()).toBeVisible();
  return !(await failed.isVisible());
}

test.describe("no trace", () => {
  test.describe("coach", () => {
    test.use({ storageState: authFile("coach") });

    test("the inbox reads, and a thread that is not yours is a 404", async ({ page }) => {
      await page.goto("/messages");
      test.skip(!(await rendered(page, page.getByTestId("inbox"))), MISSING);
      await page.goto(`/messages/${NOBODY}`);
      await expectNotFound(page);
      await page.goto("/messages/not-a-uuid");
      await expectNotFound(page);
    });

    test("an existing thread opens with its header and composer", async ({ page }) => {
      await page.goto("/messages");
      test.skip(!(await rendered(page, page.getByTestId("inbox"))), MISSING);
      const first = page.locator('a[href^="/messages/"]').first();
      test.skip((await first.count()) === 0, "this coach has no conversations");
      await first.click();
      await expect(page.getByTestId("thread-header")).toBeVisible();
      await expect(page.getByTestId("message-thread")).toBeVisible();
    });
  });

  test.describe("client", () => {
    test.use({ storageState: authFile("client") });

    test("someone else's thread is a 404, and My requests renders", async ({ page }) => {
      await page.goto(`/coach/messages/${NOBODY}`);
      const missing = page.getByText("Something went wrong on this screen");
      await expect(page.getByText("This page could not be found").or(missing).first()).toBeVisible();
      test.skip(await missing.isVisible(), MISSING);
      await expectNotFound(page);
      await page.goto("/coaches/requests");
      await expect(page.getByTestId("my-requests").or(page.getByTestId("my-requests-empty"))).toBeVisible();
      // an accepted request offers the conversation, never a second request
      const accepted = page.locator('[data-testid="my-request"][data-status="accepted"]');
      if (await accepted.count()) {
        await expect(accepted.first().getByTestId("request-message").or(accepted.first().getByRole("link", { name: "Open your coach" })))
          .toBeVisible();
      }
    });
  });
});

const FLOW = process.env.E2E_CONVERSATION_FLOW === "1";
const COACH_SLUG = process.env.E2E_PUBLISHED_COACH ?? "";
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
  test.skip(!FLOW || !COACH_SLUG || !COACH || !CLIENT,
    "set E2E_CONVERSATION_FLOW=1, E2E_PUBLISHED_COACH, E2E_FLOW_COACH and E2E_FLOW_CLIENT — disposable stacks only");
  test.setTimeout(180_000);

  test("request → accept → message both ways → start coaching keeps the thread", async ({ browser }) => {
    const stamp = Date.now().toString(36);
    const client = await as(browser, CLIENT);
    const coach = await as(browser, COACH);

    // 1. the client sends a request
    await client.page.goto(`/coaches/${COACH_SLUG}`);
    await client.page.getByTestId("contact-coach").first().click();
    const dialog = client.page.getByRole("dialog");
    await dialog.getByLabel("Message", { exact: true }).fill(`E2E ${stamp}: looking for coaching`);
    await dialog.getByTestId("coaching-request-send").click();
    await expect(dialog.getByTestId("coaching-request-sent")).toBeVisible();

    // 2. the coach accepts
    await coach.page.goto("/requests");
    const row = coach.page.getByTestId("coach-request").filter({ hasText: `E2E ${stamp}` });
    await row.getByTestId("request-accept").click();
    await coach.page.goto("/requests?tab=accepted");
    const accepted = coach.page.getByTestId("coach-request").filter({ hasText: `E2E ${stamp}` });
    await expect(accepted.getByTestId("request-message")).toBeVisible();
    await expect(accepted.getByTestId("request-start")).toBeVisible();

    // 3–5. the client sees Message coach on the profile, opens the thread, writes
    await client.page.goto(`/coaches/${COACH_SLUG}`);
    await client.page.getByTestId("message-coach").first().click();
    await expect(client.page).toHaveURL(/\/coach\/messages\/[0-9a-f-]{36}$/);
    const clientThread = client.page.url();
    await expect(client.page.getByTestId("thread-header")).toHaveAttribute("data-relationship", "request");
    await expect(client.page.getByTestId("thread-request")).toContainText(`E2E ${stamp}`);
    await client.page.getByLabel("Message…").fill(`Hi from the client ${stamp}`);
    await client.page.getByRole("button", { name: "Send" }).click();
    await expect(client.page.getByTestId("message").filter({ hasText: `Hi from the client ${stamp}` })).toBeVisible();
    const conversationId = clientThread.split("/").pop()!;

    // 6–7. the coach receives it (inbox + notification link) and replies
    await coach.page.goto("/messages");
    await expect(coach.page.locator(`a[href="/messages/${conversationId}"]`)).toContainText(`Hi from the client ${stamp}`);
    await coach.page.goto("/notifications");
    await expect(coach.page.locator(`a[href="/messages/${conversationId}"]`).first()).toBeVisible();
    await coach.page.goto(`/messages/${conversationId}`);
    await coach.page.getByLabel("Message…").fill(`Reply from the coach ${stamp}`);
    await coach.page.getByRole("button", { name: "Send" }).click();
    await expect(coach.page.getByTestId("message").filter({ hasText: `Reply from the coach ${stamp}` })).toBeVisible();

    // 8. the client receives the reply
    await client.page.goto(clientThread);
    await expect(client.page.getByTestId("message").filter({ hasText: `Reply from the coach ${stamp}` })).toBeVisible();
    // the request is still only accepted
    await client.page.goto("/coaches/requests");
    await expect(client.page.getByTestId("my-request").filter({ hasText: `E2E ${stamp}` })).toHaveAttribute("data-status", "accepted");

    // 9. the coach starts coaching
    await coach.page.goto("/requests?tab=accepted");
    await coach.page.getByTestId("coach-request").filter({ hasText: `E2E ${stamp}` }).getByTestId("request-start").click();
    await expect(coach.page.getByTestId("coach-request").filter({ hasText: `E2E ${stamp}` }).getByRole("link", { name: "Open client" }))
      .toBeVisible();

    // 10. the same conversation, every message kept, now coaching
    await coach.page.goto(`/messages/${conversationId}`);
    await expect(coach.page.getByTestId("thread-header")).toHaveAttribute("data-relationship", "active");
    await expect(coach.page.getByTestId("message")).toHaveCount(2);
    await client.page.goto("/coach");
    await expect(client.page.getByTestId("message").filter({ hasText: `Hi from the client ${stamp}` })).toBeVisible();
    await expect(client.page.getByTestId("message").filter({ hasText: `Reply from the coach ${stamp}` })).toBeVisible();

    await client.context.close();
    await coach.context.close();
  });
});
