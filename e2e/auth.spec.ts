import { expect, test } from "@playwright/test";
import { ACCOUNTS, prepare, signIn } from "./accounts";

test.beforeEach(async ({ context }) => prepare(context));

test("a signed-out visitor is sent to sign in, and back afterwards", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);
});

test("a wrong password is refused with a message", async ({ page }) => {
  await signIn(page, ACCOUNTS.client, "definitely-not-the-password");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a client who opens a coach route lands on their own home", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "e2e/.auth/client.json" });
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/today/);
  await context.close();
});

// Consent at sign-up (20261113110000): the form itself refuses to send a
// sign-up without both boxes, so this never creates an account.
test("sign-up asks for the Terms and the health-data consent before anything is sent", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByPlaceholder("Full name").fill("E2E Consent");
  await page.getByPlaceholder("Username").fill("e2e_consent_never");
  await page.getByRole("button", { name: "Male", exact: true }).click();
  await page.locator("form input[inputmode=numeric]").fill("30");
  await page.getByPlaceholder("Email").fill("e2e-consent-never@healthapp.test");
  await page.getByPlaceholder("Password", { exact: true }).fill("not-sent-123");
  await page.getByPlaceholder(/repeat/i).fill("not-sent-123");
  const terms = page.getByRole("checkbox", { name: /Terms/ });
  const health = page.getByRole("checkbox", { name: /health data/ });
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");

  let signups = 0;
  page.on("request", (r) => { if (r.url().includes("/auth/v1/signup")) signups++; });
  await terms.check();
  await page.locator("form button[type=submit]").click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Tick both boxes to continue.");
  await health.check();
  await terms.uncheck();
  await page.locator("form button[type=submit]").click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Tick both boxes to continue.");
  expect(signups).toBe(0);
});

// Resend confirmation (Email Auth Hardening). Supabase is mocked at the
// network: the password grant answers "email not confirmed" and the resend
// endpoint is counted — no account is touched and no email is sent.
async function refuseAsUnconfirmed(page: import("@playwright/test").Page) {
  await page.route("**/auth/v1/token?grant_type=password", (route) =>
    route.fulfill({
      status: 400, contentType: "application/json",
      body: JSON.stringify({ code: "email_not_confirmed", error_code: "email_not_confirmed", msg: "Email not confirmed" }),
    }),
  );
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("e2e-unconfirmed@healthapp.test");
  await page.getByPlaceholder("Password", { exact: true }).fill("not-a-real-password");
  await page.locator("form button[type=submit]").click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Confirm your email first — check your inbox.");
}

test("an unconfirmed sign-in offers one resend, then a neutral note", async ({ page }) => {
  let resends = 0;
  await page.route("**/auth/v1/resend*", (route) => {
    resends++;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await refuseAsUnconfirmed(page);

  const resend = page.getByRole("button", { name: "Resend confirmation email" });
  await resend.click();
  await expect(page.getByRole("status")).toContainText("If e2e-unconfirmed@healthapp.test has an account waiting for confirmation");
  await expect(resend).toBeDisabled();
  await resend.click({ force: true });
  expect(resends).toBe(1);
});

test("a rate-limited resend says so instead of claiming a send", async ({ page }) => {
  await page.route("**/auth/v1/resend*", (route) =>
    route.fulfill({
      status: 429, contentType: "application/json",
      body: JSON.stringify({
        code: "over_email_send_rate_limit", error_code: "over_email_send_rate_limit",
        msg: "For security purposes, you can only request this after 42 seconds.",
      }),
    }),
  );
  await refuseAsUnconfirmed(page);
  await page.getByRole("button", { name: "Resend confirmation email" }).click();
  await expect(page.getByTestId("resend-confirmation").locator("xpath=..").getByRole("alert"))
    .toHaveText("Too many emails requested. Try again in 42s.");
});

test("the resend control goes away once the email is edited", async ({ page }) => {
  await refuseAsUnconfirmed(page);
  await expect(page.getByRole("button", { name: "Resend confirmation email" })).toBeVisible();
  await page.getByPlaceholder("Email").fill("someone-else@healthapp.test");
  await expect(page.getByRole("button", { name: "Resend confirmation email" })).toHaveCount(0);
});
