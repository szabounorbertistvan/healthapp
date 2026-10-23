import { expect, test } from "../fixtures";
import { patch, rows } from "../backend";
import { ROUND, SOAK_COACH_SLUG } from "./accounts";
import { expectHealthy, idOf, soakAs } from "./helpers";

// The solo trainee finds the soak coach in the directory, asks for coaching,
// is accepted and started, writes to the coach, pauses, is resumed by the
// coach, and the coach ends it — so every round leaves them solo again, with
// one more past coach in their history. Both sides are checked at each step.
test.setTimeout(300_000);

/**
 * A round that died half-way must not leave the next one with a coach or a pending request.
 * And the directory caps how many requests one person sends a day — a real rule the solo trainee
 * meets after a dozen rounds — so earlier rounds' requests are moved back a day (history kept).
 */
async function soloAgain() {
  const solo = await idOf("solo");
  const dayAgo = new Date(Date.now() - 25 * 3_600_000).toISOString();
  await patch("coaching_requests", `client_id=eq.${solo}&created_at=gt.${dayAgo}`, { created_at: dayAgo }).catch(() => 0);
  await patch("coaching_requests", `client_id=eq.${solo}&status=eq.pending`, { status: "cancelled", resolved_at: new Date().toISOString() }).catch(() => 0);
  await patch("trainer_clients", `client_id=eq.${solo}&status=in.(active,paused,invited)`, { status: "ended", ended_at: new Date().toISOString(), ended_by: solo }).catch(() => 0);
}
test.beforeAll(soloAgain);
test.afterAll(soloAgain);

test("discover → request → accept → start → message → pause → resume → end", async ({ browser }) => {
  const soloId = await idOf("solo");
  const solo = await soakAs(browser, "solo");
  const coach = await soakAs(browser, "coach");
  const hello = `${ROUND}: I'd like a strength block.`;
  try {
    const s = solo.page;
    const c = coach.page;

    // the directory lists the coach; their page opens
    await s.goto("/coaches?all=1");
    await expect(s.locator(`a[href="/coaches/${SOAK_COACH_SLUG}"]`).first()).toBeVisible();
    await s.goto(`/coaches/${SOAK_COACH_SLUG}`);
    await expectHealthy(s);

    // request
    await s.getByTestId("contact-coach").filter({ visible: true }).first().click();
    const dialog = s.getByRole("dialog");
    await dialog.getByLabel("Message", { exact: true }).fill(hello);
    await dialog.getByTestId("coaching-request-send").filter({ visible: true }).click();
    await expect(dialog.getByTestId("coaching-request-sent").filter({ visible: true })).toBeVisible();
    await expect.poll(async () => (await rows("coaching_requests", `client_id=eq.${soloId}&status=eq.pending&message=eq.${encodeURIComponent(hello)}&select=id`)).length).toBe(1);

    // the coach accepts, then starts the coaching
    await c.goto("/requests");
    await c.getByTestId("coach-request").filter({ visible: true }).filter({ hasText: hello }).getByTestId("request-accept").filter({ visible: true }).click();
    await expect.poll(async () => (await rows("coaching_requests", `client_id=eq.${soloId}&status=eq.accepted&message=eq.${encodeURIComponent(hello)}&select=id`)).length).toBe(1);
    await c.goto("/requests?tab=accepted");
    await c.getByTestId("coach-request").filter({ visible: true }).filter({ hasText: hello }).getByTestId("request-start").filter({ visible: true }).click();
    await expect.poll(async () => (await rows<{ status: string }>("trainer_clients", `client_id=eq.${soloId}&status=eq.active&select=status`)).length).toBe(1);

    // the client has a coach now, and they can talk
    await s.goto("/coach");
    await expect(s.getByTestId("current-coach").filter({ visible: true })).toHaveAttribute("data-status", "active");
    await s.getByRole("textbox", { name: "Message…" }).fill(`Thanks for taking me on, ${ROUND}`);
    await s.getByRole("button", { name: "Send", exact: true }).click();
    await expect(s.getByTestId("message").filter({ visible: true }).filter({ hasText: `Thanks for taking me on, ${ROUND}` })).toHaveCount(1);
    await c.goto("/clients");
    await expect(c.getByText(/Soak Solo E2E|e2e_soak_solo/).filter({ visible: true }).first()).toBeVisible();

    // the client pauses (on holiday)
    await s.getByTestId("coaching-pause").filter({ visible: true }).click();
    await s.getByTestId("coaching-reason").filter({ visible: true }).selectOption("vacation");
    await s.getByTestId("coaching-confirm-button").filter({ visible: true }).click();
    await expect(s.getByTestId("current-coach").filter({ visible: true })).toHaveAttribute("data-status", "paused");

    // the coach resumes it from the paused list
    await c.goto("/clients");
    await c.getByTestId("clients-paused").filter({ visible: true }).getByTestId("client-relationship").filter({ visible: true }).filter({ hasText: /Soak Solo E2E|e2e_soak_solo/ }).first().click();
    await c.getByTestId("coaching-resume").filter({ visible: true }).click();
    await expect(c.getByTestId("coach-relationship").filter({ visible: true })).toHaveAttribute("data-status", "active");

    // and ends it; the client is solo again, with the coach in their history
    await c.getByTestId("coaching-end").filter({ visible: true }).click();
    await c.getByTestId("coaching-confirm-button").filter({ visible: true }).click();
    await expect(c.getByTestId("coach-relationship").filter({ visible: true })).toHaveAttribute("data-status", "ended");
    await s.goto("/coach");
    await expect(s.getByTestId("current-coach").filter({ visible: true })).toHaveCount(0);
    await expect(s.getByTestId("past-coaches").filter({ visible: true }).getByTestId("past-coach").filter({ visible: true }).first()).toBeVisible();
    await s.goto(`/coaches/${SOAK_COACH_SLUG}`);
    await expect(s.getByTestId("contact-coach").filter({ visible: true }).first()).toHaveAttribute("data-state", "start_new");
    expect(await rows("trainer_clients", `client_id=eq.${soloId}&status=in.(active,paused)&select=id`)).toHaveLength(0);
  } finally {
    await solo.close();
    await coach.close();
  }
});
