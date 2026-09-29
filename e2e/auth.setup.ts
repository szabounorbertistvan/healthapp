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
    await expect(page).toHaveURL(landing[who], { timeout: 45_000 });
    await context.storageState({ path: authFile(who) });
  });
}
