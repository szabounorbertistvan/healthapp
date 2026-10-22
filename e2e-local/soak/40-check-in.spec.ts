import { expect, test } from "../fixtures";
import { remove, rows } from "../backend";
import { ROUND } from "./accounts";
import { expectHealthy, idOf, soakAs } from "./helpers";

// The weekly check-in, both ways: the client sends one with a weight and a
// note, the coach finds it in the review queue and answers, the client reads
// the answer on their check-in page.
test.setTimeout(150_000);

test("client checks in → coach reviews with feedback → client reads it", async ({ browser }) => {
  const clientId = await idOf("client");
  // one check-in a week: this round's replaces whatever an earlier round sent this week
  await remove("check_ins", `user_id=eq.${clientId}&week_start=gte.${new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)}`);
  const coach = await soakAs(browser, "coach");
  const client = await soakAs(browser, "client");
  const note = `Slept badly, ${ROUND}.`;
  const answer = `Thanks — keep the volume, ${ROUND}.`;
  try {
    const p = client.page;
    await p.goto("/check-in");
    await p.getByRole("textbox", { name: "weight kg" }).fill("81,4");
    await p.getByRole("slider", { name: "Sleep quality" }).fill("4");
    await p.getByRole("textbox", { name: "anything your coach should know" }).fill(note);
    await p.getByRole("button", { name: "Submit check-in" }).click();
    await expect.poll(async () => (await rows<{ weight_kg: number }>("check_ins", `user_id=eq.${clientId}&select=weight_kg&order=submitted_at.desc&limit=1`))[0]?.weight_kg).toBe(81.4);

    const c = coach.page;
    await c.goto("/check-ins");
    await expect(c.getByText(note).filter({ visible: true })).toBeVisible();
    await c.getByRole("textbox", { name: /^Feedback for / }).first().fill(answer);
    await c.getByRole("button", { name: "Send & mark reviewed" }).first().click();
    // the reviewed card leaves the queue at once, so the database says it went through
    await expect.poll(async () => (await rows<{ coach_reviewed_at: string | null }>("check_ins", `user_id=eq.${clientId}&select=coach_reviewed_at&order=submitted_at.desc&limit=1`))[0]?.coach_reviewed_at).not.toBeNull();
    await p.goto("/check-in");
    await expect(p.getByText(answer).filter({ visible: true })).toBeVisible();
    await expectHealthy(p);
  } finally {
    await coach.close();
    await client.close();
  }
});
