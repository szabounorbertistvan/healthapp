import { expect, test } from "../fixtures";
import { patch, remove, rows } from "../backend";
import { ROUND } from "./accounts";
import { expectHealthy, idOf, soakAs, todayIso } from "./helpers";

// The coach writes a nutrition plan with a real food in breakfast and
// publishes it; the client sees it in the diary, taps "Ate as planned", and
// the diary — and the database — carry that food once.
test.setTimeout(200_000);

const NAME = `${ROUND} plan`;

test.afterAll(async () => {
  const clientId = await idOf("client");
  await remove("food_logs", `user_id=eq.${clientId}&food_name=ilike.*oats*&date=eq.${todayIso()}`).catch(() => 0);
  await remove("nutrition_plans", `name=eq.${encodeURIComponent(NAME)}`);
});

test("coach plans a breakfast → client logs it as planned", async ({ browser }) => {
  const clientId = await idOf("client");
  // one live plan per client: earlier rounds' plans step aside, as a coach replacing a plan would
  await patch("nutrition_plans", `client_id=eq.${clientId}&status=eq.published`, { status: "archived" }).catch(() => 0);
  const coach = await soakAs(browser, "coach");
  const client = await soakAs(browser, "client");
  try {
    const c = coach.page;
    await c.goto(`/nutrition/new?client=${clientId}`);
    await c.getByRole("textbox", { name: "Andrei · Cut phase" }).fill(NAME);
    const numbers = c.locator("main input[type=number]").filter({ visible: true });
    await numbers.nth(0).fill("2300");
    await numbers.nth(1).fill("160");
    await c.getByRole("button", { name: "Create template" }).click();
    await expect(c).toHaveURL(/\/nutrition\/[0-9a-f-]{36}$/);
    const planId = c.url().split("/").pop()!;
    expect((await rows<{ client_id: string }>("nutrition_plans", `id=eq.${planId}&select=client_id`))[0]?.client_id).toBe(clientId);

    // a real food into breakfast, from the USDA rows the soak stack loads
    await c.getByRole("button", { name: "Food" }).first().click();
    await c.getByPlaceholder("Search foods…").filter({ visible: true }).fill("oats");
    await c.getByRole("button", { name: "Add" }).first().click();
    await expect.poll(async () => {
      const meals = await rows<{ id: string }>("planned_meals", `plan_id=eq.${planId}&select=id`);
      const foods = await rows("planned_meal_foods", `planned_meal_id=in.(${meals.map((m) => m.id).join(",")})&select=id`);
      return foods.length;
    }).toBe(1);

    await c.getByRole("button", { name: "Publish to client" }).click();
    await expect.poll(async () => (await rows<{ status: string }>("nutrition_plans", `id=eq.${planId}&select=status`))[0]?.status).toBe("published");

    // the client's diary shows the planned breakfast; one tap logs it
    const p = client.page;
    await p.goto("/food");
    await p.getByRole("button", { name: "Ate as planned" }).first().click();
    await expect(p.getByText("Logged the whole meal").filter({ visible: true }).first()).toBeVisible();
    await expect.poll(async () => (await rows("food_logs", `user_id=eq.${clientId}&date=eq.${todayIso()}&food_name=ilike.*oats*&select=id`)).length).toBe(1);
    // a second tap would be a second breakfast: it must not be offered once the slot is filled
    await p.reload();
    await expectHealthy(p);
    await expect.poll(async () => (await rows("food_logs", `user_id=eq.${clientId}&date=eq.${todayIso()}&food_name=ilike.*oats*&select=id`)).length).toBe(1);
  } finally {
    await coach.close();
    await client.close();
  }
});
