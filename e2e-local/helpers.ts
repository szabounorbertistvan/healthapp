import { expect, type Browser, type Page } from "@playwright/test";
import { prepare } from "../e2e/accounts";
import { authFile, type Who } from "./accounts";
import { fence } from "./fixtures";

/** A page signed in as `who` (from auth.setup's saved session), in its own context. */
export async function as(browser: Browser, who: Who): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: authFile(who) });
  const violations = await fence(context);
  await prepare(context);
  const page = await context.newPage();
  return {
    page,
    close: async () => {
      await context.close();
      expect(violations(), `requests from ${who}'s page that tried to leave this machine`).toEqual([]);
    },
  };
}

/** Next's not-found page, which notFound() renders. */
export async function expectNotFound(page: Page) {
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
}

/** No error boundary on screen: a refusal must be a sentence, not a crash. */
export async function expectNoCrash(page: Page) {
  await expect(page.getByText("Something went wrong on this screen")).toHaveCount(0);
  await expect(page.getByText("Application error")).toHaveCount(0);
}

/** What settle() answers for a server action that never got a reply (lib/settle-action.ts). */
export const UNREACHABLE = /The server did not answer, so this may not have been saved/;

/** The sentence mutated() / inserted() answer when RLS refuses or filters a write. */
export const NOTHING_SAVED = /Nothing was saved\. This item is no longer available to you/;

/**
 * Fails every server-action request the page makes (a POST carrying Next's
 * `next-action` header) as a dropped connection would, until the returned
 * function is called. The server never sees them: what is tested is how the
 * screen copes with a request that never got an answer.
 */
export async function dropServerActions(page: Page): Promise<() => Promise<void>> {
  const handler = (route: import("@playwright/test").Route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort("failed") : route.fallback();
  await page.route("**/*", handler);
  return () => page.unroute("**/*", handler);
}
