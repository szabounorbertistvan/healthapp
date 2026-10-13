import { expect, test } from "./fixtures";
import { RUN, authFile } from "./accounts";
import { remove, rows } from "./backend";
import { UNREACHABLE, dropServerActions, expectNoCrash } from "./helpers";

// Coach A builds a program for client A through the real builder: every step
// is checked on screen, after a reload, and in the database. The program is
// named with this run's tag and deleted at the end, whatever happened.
test.use({ storageState: authFile("coachA") });

const NAME = `${RUN} program`;

test.afterAll(async () => {
  await remove("programs", `name=eq.${encodeURIComponent(NAME)}`);
});

async function program() {
  const found = await rows<{ id: string; status: string }>("programs", `name=eq.${encodeURIComponent(NAME)}&select=id,status`);
  return found;
}

test("create (double-clicked) → day → exercise → edit → reload: everything persisted, once", async ({ page }) => {
  await page.goto("/programs/new");
  await page.getByPlaceholder("Hypertrophy Block 1").fill(NAME);
  // a double click must not make two programs
  await page.getByRole("button", { name: "Create template" }).dblclick();
  await expect(page).toHaveURL(/\/programs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();
  const created = await program();
  expect(created, "exactly one program, a draft").toHaveLength(1);
  expect(created[0]!.status).toBe("draft");
  const id = created[0]!.id;

  await page.getByRole("button", { name: "+ Add day" }).click();
  await expect.poll(async () => (await rows("program_days", `program_id=eq.${id}&select=id`)).length).toBe(1);

  await page.getByRole("button", { name: "+ Exercise" }).first().click();
  await page.getByPlaceholder("Search exercises…").fill("barbell full squat");
  await page.getByRole("listitem").filter({ hasText: "Barbell Full Squat" }).first().getByRole("button", { name: "Choose" }).click();
  // Choose opens the targets step; the exercise is added with what is typed there
  // its fields are labelled text inputs (numeric keyboard), so they are textboxes by name
  await page.getByRole("textbox", { name: "Sets" }).fill("4");
  await page.getByRole("button", { name: "Add exercise" }).click();
  const [day] = await rows<{ id: string }>("program_days", `program_id=eq.${id}&select=id`);
  await expect.poll(async () => (await rows("program_exercises", `program_day_id=eq.${day!.id}&select=id`)).length).toBe(1);
  await expect(page.getByRole("button", { name: "Barbell Full Squat" }).first()).toBeVisible();
  expect((await rows<{ target_sets: number }>("program_exercises", `program_day_id=eq.${day!.id}&select=target_sets`))[0]?.target_sets).toBe(4);

  // then edit it in place: the value is saved on blur
  const sets = page.getByRole("spinbutton", { name: "Sets" }).first();
  await sets.fill("5");
  await sets.press("Tab");
  await expect.poll(async () =>
    (await rows<{ target_sets: number }>("program_exercises", `program_day_id=eq.${day!.id}&select=target_sets`))[0]?.target_sets,
  ).toBe(5);

  await page.reload();
  await expect(page.getByRole("button", { name: "Barbell Full Squat" }).first()).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Sets" }).first()).toHaveValue("5");
  await expectNoCrash(page);
});

test("a dropped connection while adding a day: an error on screen, nothing written, and a retry works", async ({ page }) => {
  // the program from the test above, or a fresh one if this runs alone
  let [existing] = await program();
  if (!existing) {
    await page.goto("/programs/new");
    await page.getByPlaceholder("Hypertrophy Block 1").fill(NAME);
    await page.getByRole("button", { name: "Create template" }).click();
    await expect(page).toHaveURL(/\/programs\/[0-9a-f-]{36}$/);
    [existing] = await program();
  }
  const id = existing!.id;
  const before = (await rows("program_days", `program_id=eq.${id}&select=id`)).length;
  await page.goto(`/programs/${id}`);
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();

  const restore = await dropServerActions(page);
  await page.getByRole("button", { name: "+ Add day" }).click();
  // the screen must say something went wrong — and must not pretend it saved
  await expect(page.getByText(UNREACHABLE)).toBeVisible();
  await expect(page.getByRole("heading", { name: NAME }), "the editor stays on screen").toBeVisible();
  await expectNoCrash(page);
  expect((await rows("program_days", `program_id=eq.${id}&select=id`)).length).toBe(before);

  await restore();
  await page.getByRole("button", { name: "+ Add day" }).click();
  await expect.poll(async () => (await rows("program_days", `program_id=eq.${id}&select=id`)).length).toBe(before + 1);
  await expectNoCrash(page);
});
