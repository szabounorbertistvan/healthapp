import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { ACCOUNTS, authFile, PASSWORD } from "./accounts";

// A set logged with no connection waits in the outbox (apps/web/lib/offline),
// shows as "not synced", and lands on the server once the connection is back.
//
// There is no "delete set" in the app, so the test removes its own set — and
// the session, if the test opened it — straight through PostgREST as Maria
// herself (sets_owner / sessions_owner allow it). Nothing it does finishes a
// session, so no badge or feed engine sees it.
test.use({ storageState: authFile("client") });

function supabaseEnv() {
  const env = fs.readFileSync(path.join(__dirname, "../apps/web/.env.local"), "utf8");
  const get = (key: string) => env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
  return { url: get("NEXT_PUBLIC_SUPABASE_URL")!, key: get("NEXT_PUBLIC_SUPABASE_ANON_KEY")! };
}

async function signedIn() {
  const { url, key } = supabaseEnv();
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  await supabase.auth.signInWithPassword({ email: ACCOUNTS.client, password: PASSWORD });
  return supabase;
}

/** The ids of Maria's sets received since `since`. */
async function setsSince(since: string) {
  const { data } = await (await signedIn()).from("logged_sets").select("id").gte("received_at", since);
  return data ?? [];
}

/** Deletes Maria's sets since `since`, and any session this left empty that was opened since then. */
async function cleanUp(since: string) {
  const supabase = await signedIn();
  const { data: mine } = await supabase.from("logged_sets").select("id, session_id").gte("received_at", since);
  for (const set of mine ?? []) {
    await supabase.from("logged_sets").delete().eq("id", set.id);
    const { count } = await supabase
      .from("logged_sets")
      .select("id", { count: "exact", head: true })
      .eq("session_id", set.session_id);
    if (count === 0) await supabase.from("logged_sessions").delete().eq("id", set.session_id).gte("started_at", since);
  }
}

/** Opens the set logger on Maria's first program day, the weight box filled. Null when she has none. */
async function openLogger(page: Page): Promise<{ href: string; logButton: Locator } | null> {
  await page.goto("/workout");
  // the list streams in; wait for it before reading it
  await page.locator("main a[href^='/workout/']").first().waitFor().catch(() => {});
  const dayHref = await page.locator("main a[href^='/workout/']").evaluateAll((links) =>
    links.map((a) => a.getAttribute("href")).find((h) => h && /^\/workout\/[0-9a-f-]{36}$/.test(h)),
  );
  if (!dayHref) return null;
  await page.goto(`${dayHref}/log`);
  const logButton = page.getByRole("button", { name: "Log set" }).first();
  await expect(logButton).toBeEnabled();
  // a lift with no history opens with an empty weight box; 0 is bodyweight
  const kg = page.getByRole("textbox", { name: /^(kg|lb)$/i }).first();
  if (!(await kg.inputValue())) await kg.fill("0");
  return { href: `${dayHref}/log`, logButton };
}

test("a set logged offline is kept on the phone and syncs when the connection returns", async ({ page, context }) => {
  const started = new Date(Date.now() - 60_000).toISOString();
  const logger = await openLogger(page);
  test.skip(!logger, "Maria has no program day to log against");

  try {
    await context.setOffline(true);
    await logger!.logButton.click();
    await expect(page.getByText("No connection — saved on this phone.", { exact: false })).toBeVisible();
    await expect(page.getByText("Not synced yet")).toHaveCount(1);
    await expect(page.getByText("1 set is saved only on this phone.", { exact: false })).toBeVisible();

    await context.setOffline(false);
    // the 'online' event replays the outbox, and the refresh swaps the row
    await expect(page.getByText("Not synced yet")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText("1 set is saved only on this phone.", { exact: false })).toHaveCount(0);
    expect(await setsSince(started)).toHaveLength(1);
  } finally {
    await context.setOffline(false);
    await cleanUp(started);
  }
});

test("a set whose answer was lost is replayed without being saved twice", async ({ page }) => {
  const started = new Date(Date.now() - 60_000).toISOString();
  const logger = await openLogger(page);
  test.skip(!logger, "Maria has no program day to log against");

  // The first server action reaches the server — the set is saved — but its
  // answer never comes back, as when the signal drops mid-request.
  let dropped = false;
  await page.route(`**${logger!.href}`, async (route) => {
    if (!dropped && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      dropped = true;
      await route.fetch();
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });

  try {
    await logger!.logButton.click();
    await expect(page.getByText("No connection — saved on this phone.", { exact: false })).toBeVisible();
    expect(await setsSince(started)).toHaveLength(1);
    // the outbox retries on its own (every 20 s while something waits); the
    // replay finds the set already on record and counts it as done
    await expect(page.getByText("Not synced yet")).toHaveCount(0, { timeout: 45_000 });
    expect(await setsSince(started)).toHaveLength(1);
  } finally {
    await cleanUp(started);
  }
});
