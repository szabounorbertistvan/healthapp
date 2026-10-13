import { expect, test as base, type BrowserContext } from "@playwright/test";
import { isLocalRequest } from "../scripts/lib/local-target.mjs";

/**
 * The browser side of the production guard. target() refuses non-local
 * addresses before anything starts; this fence covers what an app could still
 * do once running: every request a page makes that would leave this machine
 * is aborted, so a sign-in or a write can never reach another Supabase — not
 * through a mis-wired app, a redirect, or an absolute URL in a page.
 *
 * Images, fonts and media are only aborted (a missing picture is not a
 * failure, and they carry no session). Anything else that tried to leave —
 * a page, fetch/XHR, a websocket — fails the test that made it.
 */
const QUIET = new Set(["image", "font", "media", "stylesheet"]);

export async function fence(context: BrowserContext): Promise<() => string[]> {
  const violations: string[] = [];
  await context.route((url) => !isLocalRequest(url.toString()), (route) => {
    const request = route.request();
    if (!QUIET.has(request.resourceType())) violations.push(`${request.method()} ${request.url()} (${request.resourceType()})`);
    return route.abort("blockedbyclient");
  });
  return () => violations;
}

export const test = base.extend<{ networkFence: void }>({
  networkFence: [
    async ({ context }, use) => {
      const violations = await fence(context);
      await use();
      expect(violations(), "requests that tried to leave this machine").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
