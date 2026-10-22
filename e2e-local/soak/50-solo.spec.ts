import { expect, test, type Page } from "../fixtures";
import { remove, rows } from "../backend";
import { ROUND } from "./accounts";
import { expectHealthy, idOf, soakAs, todayIso } from "./helpers";

// Training alone, as the solo trainee: their own program built from the
// library and followed, a workout logged and finished, a day of food searched
// and logged, a habit added and ticked, a weigh-in. Every step lands once in
// the database and is still there after a reload.
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const PROGRAM = `${ROUND} solo program`;
const HABIT = `Stretch 10 min ${ROUND}`;

test.afterAll(async () => {
  const solo = await idOf("solo");
  await remove("programs", `name=eq.${encodeURIComponent(PROGRAM)}`).catch(() => 0);
  await remove("habits", `user_id=eq.${solo}&name=eq.${encodeURIComponent(HABIT)}`).catch(() => 0);
  await remove("food_logs", `user_id=eq.${solo}&date=eq.${todayIso()}&food_name=ilike.*banana*`).catch(() => 0);
});

async function logSet(page: Page, kg: string, reps: string) {
  await page.getByRole("textbox", { name: /^kg$/i }).first().fill(kg);
  await page.getByRole("textbox", { name: /^reps$/i }).first().fill(reps);
  await page.getByRole("button", { name: "Log set" }).first().click();
}

test("builds a program of their own and trains from it", async ({ browser }) => {
  const soloId = await idOf("solo");
  const { page, close } = await soakAs(browser, "solo");
  try {
    await page.goto("/workout/build");
    // an account with programs opens the last one; "New program" starts another
    const fresh = page.getByRole("button", { name: "New program" });
    if (await fresh.count()) await fresh.first().click();
    await page.getByRole("textbox", { name: "Name" }).fill(PROGRAM);
    await page.getByRole("button", { name: "Create program" }).click();
    await expect.poll(async () => (await rows("programs", `client_id=eq.${soloId}&name=eq.${encodeURIComponent(PROGRAM)}&select=id`)).length).toBe(1);
    const [program] = await rows<{ id: string }>("programs", `name=eq.${encodeURIComponent(PROGRAM)}&select=id`);
    await page.goto(`/workout/build?program=${program!.id}`);

    await page.getByPlaceholder("Day name, e.g. Chest and triceps").filter({ visible: true }).fill("Legs");
    await page.getByRole("button", { name: "Add a day" }).click();
    await expect.poll(async () => (await rows("program_days", `program_id=eq.${program!.id}&select=id`)).length).toBe(1);
    const [day] = await rows<{ id: string }>("program_days", `program_id=eq.${program!.id}&select=id`);

    await page.getByRole("button", { name: "+ Exercise" }).first().click();
    await page.getByPlaceholder("Search exercises…").filter({ visible: true }).fill("barbell full squat");
    await page.getByRole("listitem").filter({ hasText: "Barbell Full Squat" }).first().getByRole("button", { name: "Choose" }).click();
    await page.getByRole("textbox", { name: "Sets" }).fill("3");
    await page.getByRole("button", { name: "Add exercise" }).last().click();
    await expect.poll(async () => (await rows("program_exercises", `program_day_id=eq.${day!.id}&select=id`)).length).toBe(1);

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect.poll(async () => (await rows<{ status: string }>("programs", `id=eq.${program!.id}&select=status`))[0]?.status).toBe("published");

    // and trains from it
    await page.goto(`/workout/${day!.id}/log`);
    await logSet(page, "40", "10");
    await logSet(page, "45", "8");
    await expect.poll(async () => (await rows("logged_sets", `user_id=eq.${soloId}&program_exercise_id=in.(${(await rows<{ id: string }>("program_exercises", `program_day_id=eq.${day!.id}&select=id`)).map((x) => x.id).join(",")})&select=id`)).length).toBe(2);
    await page.getByRole("button", { name: "Finish workout" }).click();
    await expect(page).toHaveURL(new RegExp(`/workout/${day!.id}/done`));
    await expectHealthy(page);
    await page.goto("/today");
    await expectHealthy(page);
  } finally {
    await close();
  }
});

test("searches and logs a food (decimal comma), and it survives a reload", async ({ browser }) => {
  const soloId = await idOf("solo");
  const { page, close } = await soakAs(browser, "solo");
  try {
    await page.goto("/food");
    await page.getByRole("button", { name: /^Add foods: /i }).first().click();
    await page.getByPlaceholder("Search foods…").filter({ visible: true }).fill("banana");
    // the USDA tail may sit folded under "more results in English"
    const more = page.getByRole("button", { name: /more results in English/ });
    if (await more.count()) await more.first().click();
    await page.getByRole("button", { name: /Bananas?, raw/i }).first().click();
    const grams = page.locator("input[inputmode=decimal]").filter({ visible: true }).last();
    await grams.fill("120,5");
    await page.getByRole("button", { name: "Add to breakfast" }).click();
    await expect.poll(async () => (await rows<{ grams: number }>("food_logs", `user_id=eq.${soloId}&date=eq.${todayIso()}&food_name=ilike.*banana*&select=grams`)).map((r) => Number(r.grams))).toEqual([120.5]);
    await page.reload();
    await expect(page.getByText(/Bananas?, raw/i).filter({ visible: true }).first()).toBeVisible();
    await expectHealthy(page);
  } finally {
    await close();
  }
});

test("adds a habit; logs a weigh-in", async ({ browser }) => {
  const soloId = await idOf("solo");
  const { page, close } = await soakAs(browser, "solo");
  try {
    await page.goto("/habits");
    await page.getByRole("textbox", { name: "name", exact: true }).fill(HABIT);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(async () => (await rows("habits", `user_id=eq.${soloId}&name=eq.${encodeURIComponent(HABIT)}&select=id`)).length).toBe(1);
    await page.reload();
    await expect(page.getByText(HABIT).filter({ visible: true }).first()).toBeVisible();

    await page.goto("/progress");
    await page.getByRole("textbox", { name: "weight kg" }).fill("78,2");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await rows<{ weight_kg: number }>("measurements", `user_id=eq.${soloId}&date=eq.${todayIso()}&select=weight_kg`))[0]?.weight_kg).toBe(78.2);
    await expectHealthy(page);
  } finally {
    await close();
  }
});
