import { expect, test } from "./fixtures";
import { USERNAMES } from "./accounts";
import { patch, rows, userId } from "./backend";
import { NOTHING_SAVED, as, expectNoCrash, expectNotFound } from "./helpers";

// Two coaches, two clients, and an ended relationship (supabase/seed/e2e.sql):
// A coaches client A, B coaches client B, A used to coach client D.
// What one side may not reach must not be reachable by typing its URL either,
// and a refused write must come back as a sentence, not an error screen.

async function idOf(table: string, name: string): Promise<string> {
  const [row] = await rows<{ id: string }>(table, `name=eq.${encodeURIComponent(name)}&select=id`);
  if (!row) throw new Error(`seed row missing: ${table} ${name}`);
  return row.id;
}

test("each coach's roster holds their own clients only", async ({ browser }) => {
  const a = await as(browser, "coachA");
  const b = await as(browser, "coachB");
  try {
    await a.page.goto("/clients");
    await expect(a.page.locator("main a[href^='/clients/']").filter({ hasText: "Client Ana E2E" }).first()).toBeVisible();
    await expect(a.page.locator("main").getByText("Client Bogdan E2E")).toHaveCount(0);
    await b.page.goto("/clients");
    await expect(b.page.locator("main a[href^='/clients/']").filter({ hasText: "Client Bogdan E2E" }).first()).toBeVisible();
    await expect(b.page.locator("main").getByText("Client Ana E2E")).toHaveCount(0);
  } finally {
    await a.close();
    await b.close();
  }
});

test("coach B cannot open coach A's client, program or plan by URL", async ({ browser }) => {
  const clientA = await userId(USERNAMES.clientA);
  const program = await idOf("programs", "E2E Alpha Program");
  const plan = await idOf("nutrition_plans", "E2E Alpha Plan");
  const b = await as(browser, "coachB");
  try {
    for (const url of [`/clients/${clientA}`, `/programs/${program}`, `/nutrition/${plan}`]) {
      await b.page.goto(url);
      await expectNotFound(b.page);
      await expect(b.page.getByText("Client Ana E2E")).toHaveCount(0);
    }
    // and coach A can (the positive half, so the 404s above are not a broken page)
    const a = await as(browser, "coachA");
    await a.page.goto(`/clients/${clientA}`);
    await expect(a.page.getByRole("heading", { name: /Client Ana E2E/ }).first()).toBeVisible();
    await a.close();
  } finally {
    await b.close();
  }
});

test("a client sees their own program and nothing of another client's", async ({ browser }) => {
  const program = await idOf("programs", "E2E Alpha Program");
  const [day] = await rows<{ id: string }>("program_days", `program_id=eq.${program}&select=id`);
  const ana = await as(browser, "clientA");
  const bogdan = await as(browser, "clientB");
  try {
    await ana.page.goto("/workout");
    await expect(ana.page.getByText("E2E Alpha Program").first()).toBeVisible();

    await bogdan.page.goto("/workout");
    await expect(bogdan.page.getByText("E2E Alpha Program")).toHaveCount(0);
    await bogdan.page.goto(`/workout/${day!.id}`);
    await expectNotFound(bogdan.page);
    // the coach's editor is not a client's page at all
    await bogdan.page.goto(`/programs/${program}`);
    await expect(bogdan.page).toHaveURL(/\/today$/);
    await expect(bogdan.page.getByText("E2E Alpha Program")).toHaveCount(0);
  } finally {
    await ana.close();
    await bogdan.close();
  }
});

test.describe("after the coaching ended or paused", () => {
  // Client D's program and plan were written by coach A, whose coaching then
  // ended; client E's by coach B, whose coaching is paused. Each coach still
  // reads them, and the editor is read-only: changes disabled, with a notice.
  // The database refuses the writes on its own (pgTAP coach_write_scope, api.mjs).
  for (const c of [
    { who: "coachA" as const, program: "E2E Ended Program", plan: "E2E Ended Plan", why: "ended" },
    { who: "coachB" as const, program: "E2E Paused Program", plan: "E2E Paused Plan", why: "paused" },
  ]) {
    test(`${c.why}: the editor is read-only, readable, and nothing changes`, async ({ browser }) => {
      const program = await idOf("programs", c.program);
      const plan = await idOf("nutrition_plans", c.plan);
      const daysBefore = await rows("program_days", `program_id=eq.${program}&select=id,name`);
      const mealsBefore = await rows("planned_meals", `plan_id=eq.${plan}&select=id,name`);
      const coach = await as(browser, c.who);
      try {
        await coach.page.goto(`/programs/${program}`);
        await expect(coach.page.getByRole("heading", { name: c.program })).toBeVisible();
        await expect(coach.page.getByTestId("read-only-notice")).toBeVisible();
        await expect(coach.page.getByRole("button", { name: "+ Add day" })).toBeDisabled();
        await expect(coach.page.getByRole("button", { name: "Delete program" })).toBeDisabled();
        await expect(coach.page.getByRole("button", { name: "Delete day" }).first()).toBeDisabled();
        // copying what you wrote to a current client stays allowed
        await expect(coach.page.getByRole("button", { name: "Copy to client" })).toBeEnabled();

        await coach.page.goto(`/nutrition/${plan}`);
        await expect(coach.page.getByRole("heading", { name: c.plan })).toBeVisible();
        await expect(coach.page.getByTestId("read-only-notice")).toBeVisible();
        await expect(coach.page.getByRole("button", { name: "Different on one day" }).first()).toBeDisabled();
        await expectNoCrash(coach.page);
      } finally {
        await coach.close();
      }
      expect(await rows("programs", `id=eq.${program}&select=id`), "the program still exists").toHaveLength(1);
      expect(await rows("program_days", `program_id=eq.${program}&select=id,name`)).toEqual(daysBefore);
      expect(await rows("planned_meals", `plan_id=eq.${plan}&select=id,name`)).toEqual(mealsBefore);
    });
  }

  // An editor opened while coaching, then the client pauses: the page is stale
  // and its buttons still look live. The server refuses, and the screen says so.
  test("a stale editor after a pause: the refusal is a sentence, nothing is written", async ({ browser }) => {
    const program = await idOf("programs", "E2E Stale Program");
    const coach = await userId(USERNAMES.coachB);
    const client = await userId(USERNAMES.clientF);
    const relationship = `coach_id=eq.${coach}&client_id=eq.${client}`;
    const before = await rows("program_days", `program_id=eq.${program}&select=id`);
    const b = await as(browser, "coachB");
    try {
      await b.page.goto(`/programs/${program}`);
      await expect(b.page.getByRole("button", { name: "+ Add day" })).toBeEnabled();
      await patch("trainer_clients", relationship, { status: "paused", paused_at: new Date().toISOString(), paused_by: client, pause_reason: "vacation" });
      await b.page.getByRole("button", { name: "+ Add day" }).click();
      await expect(b.page.getByText(NOTHING_SAVED).first()).toBeVisible();
      await expectNoCrash(b.page);
      expect(await rows("program_days", `program_id=eq.${program}&select=id`)).toHaveLength(before.length);
      // after the refresh the action triggers, the page itself turns read-only
      await expect(b.page.getByTestId("read-only-notice")).toBeVisible();
    } finally {
      await b.close();
      await patch("trainer_clients", relationship, { status: "active", paused_at: null, paused_by: null, pause_reason: null });
    }
  });

  test("while coaching, the same editor is fully editable — no notice", async ({ browser }) => {
    const program = await idOf("programs", "E2E Alpha Program");
    const plan = await idOf("nutrition_plans", "E2E Alpha Plan");
    const a = await as(browser, "coachA");
    try {
      await a.page.goto(`/programs/${program}`);
      await expect(a.page.getByRole("heading", { name: "E2E Alpha Program" })).toBeVisible();
      await expect(a.page.getByTestId("read-only-notice")).toHaveCount(0);
      await expect(a.page.getByRole("button", { name: "+ Add day" })).toBeEnabled();
      await expect(a.page.getByRole("button", { name: "Delete program" })).toBeEnabled();
      await a.page.goto(`/nutrition/${plan}`);
      await expect(a.page.getByTestId("read-only-notice")).toHaveCount(0);
      await expect(a.page.getByRole("button", { name: "Different on one day" }).first()).toBeEnabled();
    } finally {
      await a.close();
    }
  });

  test("the ended client keeps seeing the plan their coach wrote", async ({ browser }) => {
    const dana = await as(browser, "clientD");
    try {
      await dana.page.goto("/workout");
      await expect(dana.page.getByText("E2E Ended Program").first()).toBeVisible();
    } finally {
      await dana.close();
    }
  });
});
