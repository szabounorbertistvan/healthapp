// HealthApp · push-dispatch edge function
// Fan-out from the notifications table to the Android app through Expo Push
// (PRODUCT_SPEC §5 internal, §8 notification catalog). Service role only —
// called by the pg_cron tick (tick_push_dispatch(), migration 20261208100000),
// never by an app.
//
// The rules from §8 are enforced here rather than at insert time, so a
// notification is always recorded even when it is not pushed: quiet hours
// 22:00–08:00 local hold non-critical categories until morning, engagement
// pushes are capped at two a day, and a category the person switched off in
// users.notification_prefs is not pushed. Notification fatigue is a named risk
// in the plan (§11) — this is where that promise is kept.
//
// Who may call is decided by Postgres, not by comparing strings (the
// comparison that broke rest-push once the project carried sb_secret_ keys):
// the caller's bearer becomes the client key, and claim_push_batch() /
// mark_pushed() / forget_push_tokens() are executable by the service role only.
// claim_push_batch() also retires what must never be pushed: rows older than
// 12 hours and rows for people with no phone.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo takes at most 100 messages per request. */
const EXPO_CHUNK = 100;
const CLAIM = 200;

/** Delivered even during quiet hours — the person asked for these or they are time-critical. */
const CRITICAL = new Set(["new_message", "new_feedback", "plan_updated", "checkin_submitted", "client_at_risk"]);

/** Capped at MAX_ENGAGEMENT_PER_DAY per person (§8 global rules). */
const ENGAGEMENT = new Set(["streak_at_risk", "achievement", "workout_reminder"]);
const MAX_ENGAGEMENT_PER_DAY = 2;

const QUIET_FROM = 22;
const QUIET_UNTIL = 8;

/** The Android notification channel each category lands in (apps/mobile/lib/push.tsx creates them). */
function channelFor(category: string): string {
  if (category === "new_message") return "messages";
  if (["new_feedback", "plan_updated", "checkin_submitted", "client_at_risk", "checkin_due"].includes(category)) return "coaching";
  if (ENGAGEMENT.has(category)) return "reminders";
  return "updates";
}

type ClaimRow = {
  id: string;
  user_id: string;
  category: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  timezone: string | null;
  notification_prefs: Record<string, boolean> | null;
  tokens: string[];
};

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channelId: string;
  priority: "high" | "normal";
  sound: null;
};

Deno.serve(async (req) => {
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!provided) return json({ error: "forbidden" }, 403);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, provided, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("claim_push_batch", { p_limit: CLAIM });
  if (error) {
    // 42501 for anything but the service role: that is the authorization check.
    return json({ error: error.code === "42501" ? "forbidden" : error.message }, error.code === "42501" ? 403 : 500);
  }
  const rows = (data ?? []) as ClaimRow[];

  const messages: ExpoMessage[] = [];
  const messageRow: string[] = []; // messages[i] belongs to notification messageRow[i]
  const skipped: string[] = [];
  let deferred = 0;
  const engagementToday = new Map<string, number>();

  for (const row of rows) {
    if (row.notification_prefs?.[row.category] === false) {
      skipped.push(row.id);
      continue;
    }
    const tz = row.timezone || "Europe/Bucharest";
    if (!CRITICAL.has(row.category) && inQuietHours(tz)) {
      deferred++;
      continue; // left unsent on purpose; a tick after 08:00 picks it up (or it retires at 12 h)
    }
    if (ENGAGEMENT.has(row.category)) {
      const sent = engagementToday.get(row.user_id) ?? (await engagementSentToday(supabase, row.user_id, tz));
      if (sent >= MAX_ENGAGEMENT_PER_DAY) {
        skipped.push(row.id);
        continue;
      }
      engagementToday.set(row.user_id, sent + 1);
    }
    for (const token of row.tokens) {
      messages.push({
        to: token,
        title: row.title,
        body: row.body ?? "",
        // Every push deep-links (§8): the app routes on category + payload.
        data: { category: row.category, notification_id: row.id, ...(row.payload ?? {}) },
        channelId: channelFor(row.category),
        priority: CRITICAL.has(row.category) ? "high" : "normal",
        sound: null, // the app never asks for a sound; the channel and the device decide
      });
      messageRow.push(row.id);
    }
  }

  /** Rows Expo answered for — handled, even when one of the person's tokens was dead. */
  const answered = new Set<string>();
  const failedRows = new Set<string>();
  const deadTokens: string[] = [];
  let delivered = 0;
  for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
    const chunk = messages.slice(i, i + EXPO_CHUNK);
    const owners = messageRow.slice(i, i + EXPO_CHUNK);
    let tickets: { status: string; details?: { error?: string } }[] = [];
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(chunk),
      });
      if (!response.ok) throw new Error(`expo ${response.status}`);
      tickets = ((await response.json()) as { data?: typeof tickets }).data ?? [];
    } catch {
      // Left unsent: the next tick retries. Backoff is the schedule itself.
      for (const id of owners) failedRows.add(id);
      continue;
    }
    chunk.forEach((message, j) => {
      const ticket = tickets[j];
      if (ticket?.status === "ok") delivered++;
      else if (ticket?.details?.error === "DeviceNotRegistered") deadTokens.push(message.to);
    });
    for (const id of owners) answered.add(id);
  }

  // A row is handled once Expo answered for it, or once it was skipped; a row
  // with a failed request (on any of its tokens) stays for the next tick.
  const handled = [...new Set([...answered, ...skipped])].filter((id) => !failedRows.has(id));
  if (handled.length > 0) await supabase.rpc("mark_pushed", { p_ids: handled });
  if (deadTokens.length > 0) await supabase.rpc("forget_push_tokens", { p_tokens: deadTokens });

  return json({
    claimed: rows.length, messages: messages.length, delivered, handled: handled.length,
    skipped: skipped.length, deferred, dead_tokens: deadTokens.length,
  });
});

function inQuietHours(timezone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: timezone }).format(new Date()),
  ) % 24;
  return hour >= QUIET_FROM || hour < QUIET_UNTIL;
}

/**
 * The instant the person's own day began, by subtracting the wall-clock time
 * that has elapsed there today. "Two a day" has to mean their day — the clock
 * quiet hours and the cron jobs are read against — not the runtime's UTC one.
 */
function startOfLocalDay(timezone: string): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(now);
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = at("hour") % 24; // some ICU builds render midnight as 24
  const elapsedMs = ((hour * 60 + at("minute")) * 60 + at("second")) * 1000;
  return new Date(now.getTime() - elapsedMs);
}

async function engagementSentToday(supabase: SupabaseClient, userId: string, timezone: string): Promise<number> {
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("category", [...ENGAGEMENT])
    .not("sent_at", "is", null)
    .gte("sent_at", startOfLocalDay(timezone).toISOString());
  return count ?? 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
