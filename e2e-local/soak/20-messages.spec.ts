import { expect, test } from "../fixtures";
import { rows } from "../backend";
import { ROUND } from "./accounts";
import { conversationId, expectHealthy, soakAs } from "./helpers";

// Coach and client write to each other in their thread, each from their own
// side of the app; every message lands once, in order, and survives a reload.
test.setTimeout(150_000);

test("coach writes → client reads and replies → coach reads the reply", async ({ browser }) => {
  const id = await conversationId();
  const coach = await soakAs(browser, "coach");
  const client = await soakAs(browser, "client");
  const fromCoach = `Coach here, ${ROUND}: how did the squats feel?`;
  const fromClient = `Client here, ${ROUND}: heavy but good.`;
  try {
    await coach.page.goto(`/messages/${id}`);
    await coach.page.getByRole("textbox", { name: "Message…" }).fill(fromCoach);
    await coach.page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(coach.page.getByTestId("message").filter({ hasText: fromCoach, visible: true })).toHaveCount(1);

    await client.page.goto(`/coach/messages/${id}`);
    await expect(client.page.getByTestId("message").filter({ hasText: fromCoach, visible: true })).toHaveCount(1);
    await client.page.getByRole("textbox", { name: "Message…" }).fill(fromClient);
    await client.page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(client.page.getByTestId("message").filter({ hasText: fromClient, visible: true })).toHaveCount(1);

    await coach.page.reload();
    await expect(coach.page.getByTestId("message").filter({ hasText: fromClient, visible: true })).toHaveCount(1);
    await expectHealthy(coach.page);

    // once each in the database, coach's first
    const sent = await rows<{ body: string }>("messages", `conversation_id=eq.${id}&body=like.*${encodeURIComponent(ROUND)}*&select=body&order=created_at`);
    expect(sent.map((m) => m.body)).toEqual([fromCoach, fromClient]);
  } finally {
    await coach.close();
    await client.close();
  }
});
