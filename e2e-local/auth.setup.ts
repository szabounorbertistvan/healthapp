import { expect, test as setup } from "./fixtures";
import { prepare, signIn } from "../e2e/accounts";
import { ACCOUNTS, PASSWORD, authFile, type Who } from "./accounts";

// Each account signs in once through the real login form and the real GoTrue;
// the specs start from the saved session. The seed gives every account a
// username and the current consent, so no one is stopped at /complete-profile.
// Client C has no coach, program or plan: /today sends such an account on to
// /welcome ("coach or solo"), so that is where it settles.
const home: Record<Who, RegExp> = {
  coachA: /\/dashboard$/, coachB: /\/dashboard$/,
  clientA: /\/today$/, clientB: /\/today$/, clientC: /\/welcome$/, clientD: /\/today$/,
};

for (const who of Object.keys(ACCOUNTS) as Who[]) {
  setup(`sign in as ${who}`, async ({ page, context }) => {
    await prepare(context);
    await signIn(page, ACCOUNTS[who], PASSWORD);
    await expect(page).toHaveURL(home[who], { timeout: 45_000 });
    // /today → /welcome is a second redirect: let it settle before believing the URL
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(home[who]);
    await context.storageState({ path: authFile(who) });
  });
}
