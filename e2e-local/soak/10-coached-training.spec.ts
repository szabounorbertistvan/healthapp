import { expect, test } from "../fixtures";
import { remove, rows } from "../backend";
import { ROUND } from "./accounts";
import { expectHealthy, idOf, soakAs } from "./helpers";

// The core loop of the product, both sides at once: the coach writes a program
// for their client and publishes it, the client logs a workout from it and
// finishes, the coach reads it set by set and comments, the client reads the
// comment on the workout. Checked on screen and in the database at each hand-over.
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const NAME = `${ROUND} program`;
let programId = "";

test.afterAll(async () => {
  // the program goes; the logged workout stays, as a real one would
  if (programId) await remove("programs", `id=eq.${programId}`);
});

test("coach writes and publishes → client logs and finishes → coach comments → client reads it", async ({ browser }) => {
  const clientId = await idOf("client");
  const coach = await soakAs(browser, "coach");
  const client = await soakAs(browser, "client");
  const comment = `Strong session (${ROUND}) — add 2.5 kg next week.`;
  try {
    // 1. the coach writes a program for this client
    const c = coach.page;
    await c.goto(`/programs/new?client=${clientId}`);
    await c.getByPlaceholder("Hypertrophy Block 1").filter({ visible: true }).fill(NAME);
    await c.getByRole("button", { name: "Create template" }).click();
    await expect(c).toHaveURL(/\/programs\/[0-9a-f-]{36}$/);
    programId = c.url().split("/").pop()!;
    await c.getByRole("button", { name: "+ Add day" }).click();
    await expect.poll(async () => (await rows("program_days", `program_id=eq.${programId}&select=id`)).length).toBe(1);
    await c.getByRole("button", { name: "+ Exercise" }).first().click();
    await c.getByPlaceholder("Search exercises…").filter({ visible: true }).fill("barbell full squat");
    await c.getByRole("listitem").filter({ hasText: "Barbell Full Squat" }).first().getByRole("button", { name: "Choose" }).click();
    await c.getByRole("textbox", { name: "Sets" }).fill("3");
    await c.getByRole("button", { name: "Add exercise" }).click();
    const [day] = await rows<{ id: string }>("program_days", `program_id=eq.${programId}&select=id`);
    await expect.poll(async () => (await rows("program_exercises", `program_day_id=eq.${day!.id}&select=id`)).length).toBe(1);

    // 2. publishes it: the client can see it now, not before
    await c.getByRole("button", { name: "Publish to client" }).click();
    await expect.poll(async () => (await rows<{ status: string }>("programs", `id=eq.${programId}&select=status`))[0]?.status).toBe("published");

    // 3. the client finds it under Training and logs two sets
    const p = client.page;
    await p.goto("/workout");
    await expect(p.locator(`a[href="/workout/${day!.id}"]`).first()).toBeVisible();
    await p.goto(`/workout/${day!.id}`);
    await p.getByRole("link", { name: "Start workout" }).or(p.getByRole("button", { name: "Start workout" })).first().click();
    await expect(p).toHaveURL(new RegExp(`/workout/${day!.id}/log$`));
    const log = async (kg: string, reps: string) => {
      await p.getByRole("textbox", { name: /^kg$/i }).first().fill(kg);
      await p.getByRole("textbox", { name: /^reps$/i }).first().fill(reps);
      await p.getByRole("button", { name: "Log set" }).first().click();
    };
    // this program's exercise only: earlier rounds' sets are under other programs
    const [planned] = await rows<{ id: string }>("program_exercises", `program_day_id=eq.${day!.id}&select=id`);
    const ours = `user_id=eq.${clientId}&program_exercise_id=eq.${planned!.id}`;
    await log("60", "8");
    await expect.poll(async () => (await rows("logged_sets", `${ours}&select=id`)).length).toBe(1);
    const [first] = await rows<{ session_id: string }>("logged_sets", `${ours}&select=session_id`);
    const sessionId = first!.session_id;
    await log("62,5", "6"); // a Romanian keyboard's decimal comma
    await expect.poll(async () => (await rows<{ weight_kg: number }>("logged_sets", `session_id=eq.${sessionId}&select=weight_kg&order=set_index`)).map((s) => Number(s.weight_kg))).toEqual([60, 62.5]);

    // 4. finishes: the done screen, and the session is complete
    await p.getByRole("button", { name: "Finish workout" }).click();
    await expect(p).toHaveURL(new RegExp(`/workout/${day!.id}/done`));
    await expectHealthy(p);
    await expect.poll(async () => (await rows<{ completed_at: string | null }>("logged_sessions", `id=eq.${sessionId}&select=completed_at`))[0]?.completed_at).not.toBeNull();
    // the day no longer reads as in progress
    await p.goto(`/workout/${day!.id}`);
    await expect(p.getByRole("link", { name: "Continue workout" }).or(p.getByRole("button", { name: "Continue workout" }))).toHaveCount(0);

    // 5. the coach reads the workout on the client's page and comments on it
    await c.goto(`/clients/${clientId}`);
    await expect(c.getByRole("heading", { name: "Recent workouts" })).toBeVisible();
    await c.getByRole("button", { name: "Comment on this workout" }).first().click();
    await c.locator("#workout-feedback-body").fill(comment);
    await c.getByTestId("client-workouts-feedback").getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(async () => (await rows("coach_feedback", `client_id=eq.${clientId}&body=eq.${encodeURIComponent(comment)}&select=id`)).length).toBe(1);

    // 6. the client reads it on the workout
    await p.goto(`/workout/session/${sessionId}`);
    await expect(p.getByText(comment).filter({ visible: true })).toBeVisible();
    await expectHealthy(p);
  } finally {
    await coach.close();
    await client.close();
  }
});
