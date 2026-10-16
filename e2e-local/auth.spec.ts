import type { BrowserContext } from "@playwright/test";
import { expect, fence, test } from "./fixtures";
import { prepare, signIn } from "../e2e/accounts";
import { signJwt } from "../scripts/pgtest/stack-env.mjs";
import { ACCOUNTS, PASSWORD, RESET_ACCOUNT, authFile } from "./accounts";
import { recoveryTokenHash, setPassword } from "./backend";
import { target } from "./target";

// Real sign-in against the real GoTrue of the local stack: the session is a
// cookie GoTrue issued, the middleware verifies it, and the pages read under it.
// e2e/auth.spec.ts covers the copy around these flows with a mocked GoTrue;
// here nothing is mocked.

test.beforeEach(async ({ context }) => prepare(context));

test("a deep link signed out → sign in → back on that page, signed in", async ({ page }) => {
  await page.goto("/programs");
  await expect(page).toHaveURL(/\/login\?next=%2Fprograms$/);
  await page.getByPlaceholder("Email").fill(ACCOUNTS.coachA);
  await page.getByPlaceholder("Password", { exact: true }).fill(PASSWORD);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/programs$/);
  await expect(page.getByRole("heading", { name: "E2E Alpha Program" }).or(page.getByText("E2E Alpha Program")).first()).toBeVisible();
});

test("a wrong password is refused and leaves no session behind", async ({ page }) => {
  await signIn(page, ACCOUNTS.clientA, "not-the-password-1");
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);
});

test("an open redirect in ?next is ignored after a real sign-in", async ({ page }) => {
  await page.goto("/login?next=%2F%2Fevil.example%2Fsteal");
  await page.getByPlaceholder("Email").fill(ACCOUNTS.clientA);
  await page.getByPlaceholder("Password", { exact: true }).fill(PASSWORD);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(new RegExp(`^${target().appUrl}/`));
  expect(new URL(page.url()).host).toBe(new URL(target().appUrl).host);
});

/** The supabase session cookie(s) of a context, decoded. @supabase/ssr may split it in chunks (.0, .1…). */
async function sessionCookie(context: BrowserContext) {
  const all = (await context.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));
  expect(all.length, "a signed-in context carries the auth cookie").toBeGreaterThan(0);
  const base = all[0]!.name.replace(/\.\d+$/, "");
  const raw = all.sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.value).join("");
  const session = JSON.parse(Buffer.from(raw.replace(/^base64-/, ""), "base64url").toString("utf8"));
  return { base, cookies: all, session };
}

test("an expired session with a dead refresh token sends a deep link to sign in", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("clientA") });
  const violations = await fence(context);
  await prepare(context);
  const { base, cookies, session } = await sessionCookie(context);
  // the same session, its access token expired an hour ago and its refresh token revoked
  const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"));
  const expired = signJwt({ ...claims, iat: claims.iat - 7200, exp: Math.floor(Date.now() / 1000) - 3600 });
  const forged = { ...session, access_token: expired, expires_at: Math.floor(Date.now() / 1000) - 3600, refresh_token: "revoked-refresh-token" };
  await context.clearCookies();
  await context.addCookies([{ ...cookies[0]!, name: base, value: "base64-" + Buffer.from(JSON.stringify(forged)).toString("base64url") }]);
  const page = await context.newPage();
  await page.goto("/progress");
  await expect(page).toHaveURL(/\/login\?next=%2Fprogress$/);
  await context.close();
  expect(violations()).toEqual([]);
});

test("a tampered session cookie is a signed-out visitor, not an error", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("coachA") });
  const violations = await fence(context);
  await prepare(context);
  const { base, cookies } = await sessionCookie(context);
  await context.clearCookies();
  await context.addCookies([{ ...cookies[0]!, name: base, value: "base64-bm90LWEtc2Vzc2lvbg" }]);
  const page = await context.newPage();
  const res = await page.goto("/clients");
  expect(res?.status()).toBeLessThan(500);
  await expect(page).toHaveURL(/\/login\?next=%2Fclients$/);
  await context.close();
  expect(violations()).toEqual([]);
});

test.describe("password reset", () => {
  const NEW_PASSWORD = "Voinic-E2E-reset-2";
  test.afterAll(async () => setPassword(RESET_ACCOUNT, PASSWORD));

  test("recovery link → new password → sign in with it; the old one and the used link stop working", async ({ page }) => {
    // what the reset email carries, minted by GoTrue itself (there is no mail server locally)
    const tokenHash = await recoveryTokenHash(RESET_ACCOUNT);
    const link = `/auth/callback?token_hash=${tokenHash}&type=recovery&next=%2Freset-password`;
    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password$/);
    const fields = page.locator("form input[type=password]");
    await expect(fields.first()).toBeVisible();
    for (const field of await fields.all()) await field.fill(NEW_PASSWORD);
    await page.locator("form button[type=submit]").click();
    await expect(page).not.toHaveURL(/\/reset-password/, { timeout: 30_000 });

    // the old password no longer opens the account; the new one does
    await page.context().clearCookies();
    await signIn(page, RESET_ACCOUNT, PASSWORD);
    await expect(page.locator("form").getByRole("alert")).toBeVisible();
    await signIn(page, RESET_ACCOUNT, NEW_PASSWORD);
    // e2e-reset is a client with no coach and no program (supabase/seed/e2e.sql), so
    // signed in it lands where every empty account does: Today sends it on to the
    // coach-or-solo choice (onboarding.spec.ts expects the same), not to /today itself
    await expect(page).toHaveURL(/\/welcome$/, { timeout: 30_000 });
    // …and it is a session, not a page a signed-out visitor could reach
    await page.goto("/progress");
    await expect(page).toHaveURL(/\/progress$/);

    // a recovery link works once
    await page.context().clearCookies();
    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password\?error=expired$/);
    await expect(page.getByText("This link has expired")).toBeVisible();
  });
});
