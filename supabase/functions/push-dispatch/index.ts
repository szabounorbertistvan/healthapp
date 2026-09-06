// BuddyGym · push-dispatch edge function
// Fan-out from the notifications table to Expo Push (PRODUCT_SPEC §5 internal,
// §8 notification catalog). Service role only — called by pg_cron, never by an app.
//
// The rules from §8 are enforced here rather than at insert time, so a
// notification is always recorded even when it is not pushed: quiet hours
// 22:00–08:00 local queue non-critical categories until morning, and engagement
// pushes are capped at two a day. Notification fatigue is a named risk in the
// plan (§11) — this is where that promise is kept.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH = 100;
/** Ceiling on rows read per run while paging past quiet-hours deferrals. */
const MAX_SCAN = 1000;

/** Delivered even during quiet hours — the user asked for these or they are time-critical. */
const CRITICAL = new Set(["new_message", "new_feedback", "plan_updated", "checkin_submitted", "client_at_risk"]);

/** Capped at MAX_ENGAGEMENT_PER_DAY per user (§8 global rules). */
const ENGAGEMENT = new Set(["streak_at_risk", "achievement", "workout_reminder"]);
const MAX_ENGAGEMENT_PER_DAY = 2;

const QUIET_FROM = 22;
const QUIET_UNTIL = 8;

type NotificationRow = {
  id: string;
  user_id: string;
  category: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  users: { push_token: string | null; timezone: string; notification_prefs: Record<string, boolean> } | null;
};

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const provided = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (provided !== serviceKey) return json({ error: "forbidden" }, 403);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const messages: { to: string; title: string; body: string; data: unknown }[] = [];
  const pushed: string[] = [];
  const skipped: string[] = [];
  let deferred = 0;
  let scanned = 0;

  // Quiet-hours rows are left unsent and unmarked, so they stay at the head of
  // the created_at ordering. Reading a single page would let a night's backlog
  // of engagement notifications starve the critical ones queued behind them, so
  // page past what is deferred until a batch of deliverable messages is filled.
  let offset = 0;
  while (messages.length + skipped.length < BATCH && offset < MAX_SCAN) {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, user_id, category, title, body, payload, users(push_token, timezone, notification_prefs)")
      .is("sent_at", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + BATCH - 1);

    if (error) return json({ error: error.message }, 500);

    const page = (data ?? []) as unknown as NotificationRow[];
    if (page.length === 0) break;
    offset += page.length;
    scanned += page.length;

    for (const row of page) {
      const user = row.users;
      if (!user?.push_token) {
        skipped.push(row.id); // no device registered — the row stays as in-app history
        continue;
      }
      if (user.notification_prefs?.[row.category] === false) {
        skipped.push(row.id);
        continue;
      }
      if (!CRITICAL.has(row.category) && inQuietHours(user.timezone)) {
        deferred++;
        continue; // left unsent on purpose; the next run picks it up after 08:00
      }
      if (
        ENGAGEMENT.has(row.category) &&
        (await engagementSentToday(supabase, row.user_id, user.timezone)) >= MAX_ENGAGEMENT_PER_DAY
      ) {
        skipped.push(row.id);
        continue;
      }

      messages.push({
        to: user.push_token,
        title: row.title,
        body: row.body ?? "",
        data: { category: row.category, ...row.payload }, // every push deep-links (§8)
      });
      pushed.push(row.id);
      if (messages.length >= BATCH) break; // Expo caps one request at 100
    }
  }

  if (messages.length > 0) {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      // Leave sent_at null: the next scheduled run retries. Backoff is the
      // schedule itself, so a failing provider cannot spin this function.
      return json({ error: "expo_push_failed", status: response.status, pending: pushed.length }, 502);
    }
  }

  const toMark = [...pushed, ...skipped];
  if (toMark.length > 0) {
    await supabase.from("notifications").update({ sent_at: new Date().toISOString() }).in("id", toMark);
  }

  return json({ pushed: pushed.length, skipped: skipped.length, deferred, scanned });
});

function inQuietHours(timezone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: timezone || "Europe/Bucharest" })
      .format(new Date()),
  );
  return hour >= QUIET_FROM || hour < QUIET_UNTIL;
}

/**
 * The instant the user's own day began, by subtracting the wall-clock time that
 * has elapsed there today. "Two a day" has to mean their day — the same clock
 * quiet hours and the cron jobs are read against — not the runtime's UTC one.
 */
function startOfLocalDay(timezone: string): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone || "Europe/Bucharest",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = at("hour") % 24; // some ICU builds render midnight as 24
  const elapsedMs = ((hour * 60 + at("minute")) * 60 + at("second")) * 1000;
  return new Date(now.getTime() - elapsedMs);
}

async function engagementSentToday(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
): Promise<number> {
  const since = startOfLocalDay(timezone);
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("category", [...ENGAGEMENT])
    .not("sent_at", "is", null)
    .gte("sent_at", since.toISOString());
  return count ?? 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
