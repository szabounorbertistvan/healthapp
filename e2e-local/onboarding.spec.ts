import type { Browser, Page } from "@playwright/test";
import { expect, fence, test } from "./fixtures";
import { signIn } from "../e2e/accounts";
import { PASSWORD } from "./accounts";
import { patch, remove, rows, userId } from "./backend";
import { as, dropServerActions, expectNoCrash } from "./helpers";

// Onboarding (20261123100000, components/onboarding/*) with two accounts that
// signed up after it existed — e2e-new-client and e2e-new-coach have no
// onboarding row in the seed — and one that existed before (client A).
//
// These contexts do NOT set the device's "no automatic tips" switch that
// e2e/accounts.ts prepare() sets for every other spec: the tours are what is
// being tested here.

const NEW_CLIENT = { email: "e2e-new-client@voinic.test", username: "e2e_new_client" };
const NEW_COACH = { email: "e2e-new-coach@voinic.test", username: "e2e_new_coach" };

type State = Record<string, string>;
async function stateOf(username: string): Promise<State> {
  const [row] = await rows<{ state: State }>("onboarding_state", `user_id=eq.${await userId(username)}&select=state`);
  return row?.state ?? {};
}

async function reset(username: string) {
  const id = await userId(username);
  await remove("onboarding_state", `user_id=eq.${id}`);
  await remove("goals", `user_id=eq.${id}`);
  await patch("users", `id=eq.${id}`, { weight_unit: "kg" });
}

/** A fresh browser session — like a new device — with tips left on. */
async function freshSession(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const violations = await fence(context); // the suite's guard: nothing leaves this machine
  const base = process.env.E2E_BASE_URL ?? "http://localhost:3210";
  await context.addCookies([{ name: "bg-locale", value: "en", url: base }]);
  await context.addInitScript(() => {
    try { localStorage.setItem("bg-analytics-consent-v1", "denied"); } catch {}
  });
  const page = await context.newPage();
  return {
    page,
    close: async () => {
      await context.close();
      expect(violations(), "requests that tried to leave this machine").toEqual([]);
    },
  };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await reset(NEW_CLIENT.username);
  await reset(NEW_COACH.username);
});
test.afterAll(async () => {
  await reset(NEW_CLIENT.username);
  await reset(NEW_COACH.username);
});

test("a new client: welcome cards, two steps, leaves, and resumes in a new session", async ({ browser }) => {
  const first = await freshSession(browser);
  const page = first.page;
  await signIn(page, NEW_CLIENT.email, PASSWORD);

  // brand new: /today sends them to the welcome cards, once
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Coach. Plan. Progress." })).toBeVisible();
  // a client's cards, not a coach's
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start now, discover later" })).toBeVisible();
  await expect(page.getByText("Your clients at a glance")).toHaveCount(0);
  await page.getByRole("button", { name: "Set up my profile" }).click();

  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Add a profile photo" })).toBeVisible();
  // nothing is required: the photo step can be skipped
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Units and time zone" })).toBeVisible();
  await page.getByLabel("Weight").selectOption("lb");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your main goal" })).toBeVisible();

  // and leave mid-way: the app is not held behind the flow
  await page.getByRole("link", { name: "Finish later" }).click();
  await expect(page).toHaveURL(/\/welcome$/); // an empty account's existing coach-or-solo choice
  await expectNoCrash(page);

  expect(await stateOf(NEW_CLIENT.username)).toEqual({ welcome: "done", "step:photo": "skipped", "step:units": "done" });
  const [user] = await rows<{ weight_unit: string }>("users", `username=eq.${NEW_CLIENT.username}&select=weight_unit`);
  expect(user.weight_unit).toBe("lb"); // the account's own column, through updateAccount
  await first.close();

  // ---- a new session, another "device": no welcome cards again, setup resumes where it stopped ----
  const second = await freshSession(browser);
  const p2 = second.page;
  await signIn(p2, NEW_CLIENT.email, PASSWORD);
  await expect(p2).toHaveURL(/\/welcome$/, { timeout: 45_000 });
  await p2.goto("/onboarding");
  await expect(p2.getByText("Step 3 of 4")).toBeVisible();
  await expect(p2.getByRole("heading", { level: 1, name: "Your main goal" })).toBeVisible();
  // a refresh keeps the step
  await p2.reload();
  await expect(p2.getByRole("heading", { level: 1, name: "Your main goal" })).toBeVisible();

  await p2.getByRole("button", { name: "Muscle gain" }).click();
  await p2.getByRole("button", { name: "Save and continue" }).click();
  await expect(p2.getByRole("heading", { level: 1, name: "How you'll train" })).toBeVisible();
  await p2.getByRole("button", { name: "I'll train on my own" }).click();

  await expect(p2.getByRole("heading", { level: 1, name: "You're set" })).toBeVisible();
  await expect(p2.getByText("Skipped steps wait for you on Today")).toBeVisible();
  const goals = await rows<{ title: string; status: string }>("goals", `user_id=eq.${await userId(NEW_CLIENT.username)}&select=title,status`);
  expect(goals).toEqual([{ title: "Muscle gain", status: "active" }]);

  await p2.getByRole("button", { name: "Go to Today" }).click();
  await expect(p2).toHaveURL(/\/today$/);

  // the way back to the skipped photo step
  await expect(p2.getByText("Finish setting up")).toBeVisible();
  await expect(p2.getByText("3 of 4 steps done")).toBeVisible();

  // ---- the Today tour opens by itself, once ----
  const tour = p2.getByRole("dialog", { name: "Your week in one number" });
  await expect(tour).toBeVisible();
  // closing it while the connection is down: kept on this device, not shown again, sent later
  const restore = await dropServerActions(p2);
  await p2.keyboard.press("Escape");
  await expect(tour).toHaveCount(0);
  await restore();
  await p2.reload();
  await p2.waitForTimeout(1_500); // past the tour's own start delay
  await expect(p2.getByRole("dialog", { name: "Your week in one number" })).toHaveCount(0);
  await expect.poll(async () => (await stateOf(NEW_CLIENT.username))["tour:today"]).toBe("dismissed");

  // ---- reopened from its button, walked to the end, by keyboard ----
  await p2.getByRole("button", { name: "Guided tour" }).click();
  await expect(p2.getByRole("dialog", { name: "Your week in one number" })).toBeFocused();
  for (let i = 0; i < 6; i++) {
    const done = p2.getByRole("button", { name: "Got it" });
    if (await done.isVisible()) break;
    await p2.getByRole("dialog").getByRole("button", { name: "Next", exact: true }).click();
  }
  await p2.getByRole("button", { name: "Got it" }).click();
  await expect(p2.getByRole("dialog")).toHaveCount(0);
  await expect(p2.getByRole("button", { name: "Guided tour" })).toBeFocused();
  await expect.poll(async () => (await stateOf(NEW_CLIENT.username))["tour:today"]).toBe("done");

  // ---- hiding the setup card is remembered ----
  await p2.getByRole("button", { name: "Hide the setup checklist" }).click();
  await expect(p2.getByText("Finish setting up")).toHaveCount(0);
  await expect.poll(async () => (await stateOf(NEW_CLIENT.username)).setup).toBe("dismissed");
  await p2.reload();
  await expect(p2.getByText("Finish setting up")).toHaveCount(0);
  await expectNoCrash(p2);
  await second.close();
});

test("a new coach gets the coach flow, never the client's, and can skip straight through", async ({ browser }) => {
  const { page, close } = await freshSession(browser);
  await signIn(page, NEW_COACH.email, PASSWORD);
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 45_000 });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your clients at a glance" })).toBeVisible();

  await page.getByRole("button", { name: "Skip intro" }).click();
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your public coach page" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the profile wizard" })).toHaveAttribute("href", "/settings/coach-profile");
  await expect(page.getByText("Your main goal")).toHaveCount(0);

  await page.getByRole("link", { name: "Finish later" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  // not bounced back: the intro was answered
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Finish setting up")).toBeVisible();
  expect(await stateOf(NEW_COACH.username)).toEqual({ welcome: "skipped", "step:photo": "skipped" });

  // the role was never touched
  const [user] = await rows<{ role: string }>("users", `username=eq.${NEW_COACH.username}&select=role`);
  expect(user.role).toBe("coach");
  await close();
});

test("an existing account is never sent to the welcome cards", async ({ browser }) => {
  const before = await stateOf("e2e_client_a");
  expect(before.welcome).toBe("done");
  const { page, close } = await as(browser, "clientA");
  await page.goto("/today");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("button", { name: "Guided tour" })).toBeVisible();
  // prepare() switched automatic tips off on this device: nothing opens over the page
  await page.waitForTimeout(1_500);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await stateOf("e2e_client_a")).toEqual(before);
  await close();
});
