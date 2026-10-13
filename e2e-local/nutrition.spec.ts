import { expect, test } from "./fixtures";
import { RUN, authFile } from "./accounts";
import { remove, rows } from "./backend";
import { UNREACHABLE, dropServerActions, expectNoCrash } from "./helpers";

// Coach A creates nutrition plans for client A through /nutrition/new. Every
// plan this spec makes carries the run tag in its name and is removed at the
// end. The meal-slot failure is real: supabase/seed/e2e.sql installs a trigger
// (local stack only) that fails the slot insert for a plan whose name carries
// "[e2e:fail-meals]", so the app's own rollback path is what gets exercised.
test.use({ storageState: authFile("coachA") });

const like = `name=like.${encodeURIComponent(`${RUN}*`)}`;

test.afterAll(async () => {
  await remove("nutrition_plans", like);
});

async function plansNamed(name: string) {
  return rows<{ id: string; kcal_target: number; protein_target_g: number }>(
    "nutrition_plans", `name=eq.${encodeURIComponent(name)}&select=id,kcal_target,protein_target_g`);
}

async function fill(page: import("@playwright/test").Page, v: { name: string; kcal?: string; protein?: string }) {
  await page.goto("/nutrition/new");
  await page.getByPlaceholder("Andrei · Cut phase").fill(v.name);
  const numbers = page.locator("main input[type=number]");
  if (v.kcal) await numbers.nth(0).fill(v.kcal);
  if (v.protein) await numbers.nth(1).fill(v.protein);
}

test("create (double-clicked) → the four meal slots → reload: persisted, once", async ({ page }) => {
  const name = `${RUN} plan`;
  await fill(page, { name, kcal: "2400", protein: "180" });
  await page.getByRole("button", { name: "Create template" }).dblclick();
  await expect(page).toHaveURL(/\/nutrition\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  const plans = await plansNamed(name);
  expect(plans, "exactly one plan").toHaveLength(1);
  expect(plans[0]).toMatchObject({ kcal_target: 2400, protein_target_g: 180 });
  const meals = await rows<{ slot: string }>("planned_meals", `plan_id=eq.${plans[0]!.id}&select=slot&order=position`);
  expect(meals.map((m) => m.slot)).toEqual(["breakfast", "lunch", "dinner", "snack"]);

  await page.reload();
  for (const heading of ["Breakfast", "Lunch", "Dinner", "Snack"]) {
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }
  await expect(page.getByText("2400 kcal").first()).toBeVisible();
});

test("out-of-range calories and macros are refused before anything is written", async ({ page }) => {
  const tooMuchProtein = `${RUN} protein 3000`;
  await fill(page, { name: tooMuchProtein, protein: "3000" });
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByText("Macro targets must be whole grams between 0 and 2500")).toBeVisible();
  await expect(page).toHaveURL(/\/nutrition\/new$/);

  // calories have min/max on the field itself: the browser refuses to submit, nothing reaches the server
  const tooFewCalories = `${RUN} kcal 300`;
  await fill(page, { name: tooFewCalories, kcal: "300" });
  await page.getByRole("button", { name: "Create template" }).click();
  expect(await page.locator("main input[type=number]").nth(0).evaluate((el) => (el as HTMLInputElement).validity.rangeUnderflow)).toBe(true);
  await expect(page).toHaveURL(/\/nutrition\/new$/);

  expect(await plansNamed(tooMuchProtein)).toHaveLength(0);
  expect(await plansNamed(tooFewCalories)).toHaveLength(0);
  await expectNoCrash(page);
});

test("when the meal slots fail to save, the screen says so and no half-made plan is left", async ({ page }) => {
  const name = `${RUN} [e2e:fail-meals]`;
  await fill(page, { name });
  await page.getByRole("button", { name: "Create template" }).click();
  // the database's own error reaches the form; the coach stays on it to retry
  await expect(page.getByText("E2E_INJECTED_MEAL_FAILURE")).toBeVisible();
  await expect(page).toHaveURL(/\/nutrition\/new$/);
  await expectNoCrash(page);
  // the compensating delete removed the plan row the first insert made
  expect(await plansNamed(name)).toHaveLength(0);
});

test("a dropped connection on create: a message, no navigation, and the retry makes one plan", async ({ page }) => {
  const name = `${RUN} retry`;
  await fill(page, { name });
  const restore = await dropServerActions(page);
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByText(UNREACHABLE)).toBeVisible();
  await expect(page).toHaveURL(/\/nutrition\/new$/);
  await expectNoCrash(page);
  expect(await plansNamed(name)).toHaveLength(0);

  await restore();
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page).toHaveURL(/\/nutrition\/[0-9a-f-]{36}$/);
  expect(await plansNamed(name)).toHaveLength(1);
});
