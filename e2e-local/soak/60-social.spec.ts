import { expect, test } from "../fixtures";
import { remove, rows } from "../backend";
import { ROUND } from "./accounts";
import { expectHealthy, idOf, soakAs } from "./helpers";

// Client and coach on the feed: the client posts, the coach follows them, gives
// kudos and comments; the client finds all three in their notifications and
// on the post, once each. The post is deleted at the end of the round.
test.setTimeout(200_000);

const TEXT = `Felt strong today — ${ROUND}`;

test.afterAll(async () => {
  await remove("social_posts", `text=eq.${encodeURIComponent(TEXT)}`).catch(() => 0);
});

test("client posts → coach follows, gives kudos, comments → client is notified", async ({ browser }) => {
  const clientId = await idOf("client");
  const coachId = await idOf("coach");
  const client = await soakAs(browser, "client");
  const coach = await soakAs(browser, "coach");
  const comment = `Great work — ${ROUND}`;
  try {
    const p = client.page;
    await p.goto("/feed");
    await p.getByRole("button", { name: "What's on your mind?" }).click();
    await p.getByRole("textbox", { name: "Share something — a lift, a milestone, a good day." }).fill(TEXT);
    await p.getByRole("button", { name: "Post", exact: true }).click();
    await expect.poll(async () => (await rows("social_posts", `user_id=eq.${clientId}&text=eq.${encodeURIComponent(TEXT)}&select=id`)).length).toBe(1);
    const [post] = await rows<{ id: string }>("social_posts", `user_id=eq.${clientId}&text=eq.${encodeURIComponent(TEXT)}&select=id`);

    // the coach follows the client (unless an earlier round already does)
    const c = coach.page;
    await c.goto(`/people/${clientId}`);
    const follow = c.getByRole("button", { name: "Follow", exact: true });
    if (await follow.count()) {
      await follow.click();
      await expect.poll(async () => (await rows("social_follows", `follower_id=eq.${coachId}&following_id=eq.${clientId}&select=follower_id`)).length).toBe(1);
    }

    // kudos and a comment on the post
    await c.goto(`/feed/${post!.id}`);
    await expect(c.getByText(TEXT).filter({ visible: true })).toBeVisible();
    await c.getByRole("button", { name: /^Strong/ }).first().click();
    await expect.poll(async () => (await rows("social_reactions", `post_id=eq.${post!.id}&select=user_id`)).length).toBe(1);
    await c.getByRole("textbox", { name: "Write a comment…" }).fill(comment);
    await c.getByRole("textbox", { name: "Write a comment…" }).press("Enter");
    await expect(c.getByText(comment).filter({ visible: true })).toBeVisible();
    await expect.poll(async () => (await rows("social_comments", `post_id=eq.${post!.id}&select=id`)).length).toBe(1);

    // the client: the comment on the post, and the kudos + comment as notifications
    await p.goto(`/feed/${post!.id}`);
    await expect(p.getByText(comment).filter({ visible: true })).toBeVisible();
    await p.goto("/notifications");
    await expect(p.getByText(/(Soak Coach E2E|e2e_soak_coach) commented on your post/).filter({ visible: true }).first()).toBeVisible();
    await expect(p.getByText(/(Soak Coach E2E|e2e_soak_coach) reacted to your post/).filter({ visible: true }).first()).toBeVisible();
    await expectHealthy(p);
  } finally {
    await client.close();
    await coach.close();
  }
});
