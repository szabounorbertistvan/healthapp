import { expect, test as setup } from "../fixtures";
import { prepare, signIn } from "../../e2e/accounts";
import { PASSWORD } from "../accounts";
import { SOAK, soakAuth, type SoakWho } from "./accounts";

// Every round signs the trio in again through the real form, so a long soak
// never runs on a session that expired hours ago. The solo account answers
// /welcome's "coach or solo" once here (a per-device cookie, kept in the saved
// state); the coached client and the coach land on their homes.
const home: Record<SoakWho, RegExp> = { coach: /\/dashboard$/, client: /\/today$/, solo: /\/(today|welcome)$/ };

for (const who of Object.keys(SOAK) as SoakWho[]) {
  setup(`sign in as soak ${who}`, async ({ page, context }) => {
    await prepare(context);
    await signIn(page, SOAK[who], PASSWORD);
    await expect(page).toHaveURL(home[who], { timeout: 45_000 });
    await page.waitForLoadState("networkidle");
    if (who === "solo" && /\/welcome$/.test(page.url())) {
      await page.getByRole("button", { name: "Build my program" }).or(page.getByRole("link", { name: "Build my program" })).first().click();
      await expect(page).not.toHaveURL(/\/welcome$/);
    }
    await context.storageState({ path: soakAuth(who) });
  });
}
