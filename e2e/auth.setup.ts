import { expect, test as setup } from "@playwright/test";
import { ACCOUNTS, authFile, prepare, signIn, type Who } from "./accounts";

// Sign each account in once; the specs start from the saved session.
const landing: Record<Who, RegExp> = {
  client: /\/today/,
  coach: /\/dashboard/,
  coach2: /\/dashboard/,
};

for (const who of Object.keys(ACCOUNTS) as Who[]) {
  setup(`sign in as ${who}`, async ({ page, context }) => {
    await prepare(context);
    await signIn(page, ACCOUNTS[who]);
    // An account with no consent on record (20261113110000) is asked first;
    // giving it is the same click a person makes, recorded the same way.
    // /dashboard → /today → /complete-profile is a chain of redirects: wait
    // for it to settle before reading where it ended.
    await expect(page).toHaveURL(new RegExp(`${landing[who].source}|/complete-profile`), { timeout: 45_000 });
    await page.waitForLoadState("networkidle");
    if (page.url().includes("/complete-profile")) {
      await page.getByRole("checkbox", { name: /Terms/ }).check();
      await page.getByRole("checkbox", { name: /health data/ }).check();
      await page.getByRole("button", { name: "Continue" }).click();
    }
    await expect(page).toHaveURL(landing[who], { timeout: 45_000 });
    await context.storageState({ path: authFile(who) });
  });
}
