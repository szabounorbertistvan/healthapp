// HealthApp · rest-push edge function
// Delivers "rest finished" as a Web Push (RFC 8291/8292) to every browser the
// person subscribed. Service role only — called by the pg_cron tick
// (tick_rest_pushes(), migration 20260919100000), never by an app.
//
// Why a server does this at all: the timer lives in the browser, but a locked
// phone runs no JavaScript, so the only thing that can fire at `endsAt` is
// something that knows `endsAt` and is awake — this. The schedule row is
// claimed (marked sent) *before* the push goes out, in one statement, so the
// same rest can never be announced twice however many ticks overlap.
//
// The payload carries a title, a body, a path and the person's own `alert`
// setting; the service worker (apps/web/public/sw.js) shows it with
// `silent: !alert` and never a vibration pattern. Whether an alert lights the
// lock screen is the OS's business — nothing here asks for sound.
//
// Secrets (supabase secrets set …):
//   VAPID_KEYS_JSON  — {"publicKey": JWK, "privateKey": JWK}, from scripts/vapid-keys.mjs
//   VAPID_SUBJECT    — "mailto:…" or the site URL, what push services may contact
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

/** Past this the person has long since started (or given up on) the set. */
const TTL_SECONDS = 120;

type RestPushRow = {
  id: string;
  user_id: string;
  notify_at: string;
  title: string;
  body: string;
  url: string;
  /** The person's RestPrefs.alert, stamped on the row when the rest started. */
  alert: boolean | null;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

Deno.serve(async (req) => {
  // Who is calling is decided by Postgres, not by comparing strings: the
  // caller's own bearer becomes the client's key, and claim_due_rest_pushes()
  // is executable by the service role alone (revoked from authenticated and
  // anon in 20260919100000). A user token gets 42501 and nothing else — the
  // same grant the pgTAP suite pins down. This also survives the project's
  // key rotation: the value in vault need only be *a* service-role key, not
  // byte-equal to whatever the runtime injects as SUPABASE_SERVICE_ROLE_KEY.
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!provided) return json({ error: "forbidden" }, 403);

  const keysJson = Deno.env.get("VAPID_KEYS_JSON");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!keysJson || !subject) return json({ error: "vapid_not_configured" }, 500);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, provided, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Claim first: whatever happens below, these rows are spoken for.
  const { data: claimed, error: claimError } = await supabase.rpc("claim_due_rest_pushes", { p_limit: 100 });
  if (claimError) {
    const forbidden = claimError.code === "42501";
    return json({ error: forbidden ? "forbidden" : claimError.message }, forbidden ? 403 : 500);
  }
  const due = (claimed ?? []) as RestPushRow[];
  if (due.length === 0) return json({ sent: 0, due: 0 });

  const userIds = [...new Set(due.map((row) => row.user_id))];
  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (subsError) return json({ error: subsError.message }, 500);
  const byUser = new Map<string, SubscriptionRow[]>();
  for (const sub of (subs ?? []) as SubscriptionRow[]) {
    byUser.set(sub.user_id, [...(byUser.get(sub.user_id) ?? []), sub]);
  }

  const vapidKeys = await webpush.importVapidKeys(JSON.parse(keysJson) as webpush.ExportedVapidKeys, {
    extractable: false,
  });
  const appServer = await webpush.ApplicationServer.new({ contactInformation: subject, vapidKeys });

  let sent = 0;
  let failed = 0;
  const gone: string[] = [];
  const errors: string[] = [];
  const results = await Promise.allSettled(
    due.flatMap((row) =>
      (byUser.get(row.user_id) ?? []).map(async (sub) => {
        const subscriber = appServer.subscribe({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } });
        try {
          await subscriber.pushTextMessage(
            JSON.stringify({ kind: "rest_finished", id: row.id, title: row.title, body: row.body, url: row.url, alert: row.alert !== false }),
            {
              ttl: TTL_SECONDS,
              urgency: webpush.Urgency.High,
              // One topic per rest: a push service that still holds an
              // undelivered one for this rest replaces it rather than queuing.
              // RFC 8030 caps a topic at 32 base64url characters — the bare
              // uuid hex is exactly that. Apple enforces it (400
              // BadWebPushTopic, so nothing ever reached an iPhone while this
              // carried a "rest-" prefix); FCM does not.
              topic: row.id.replace(/-/g, "").slice(0, 32),
            },
          );
          sent++;
        } catch (error) {
          // 404/410: the browser unsubscribed (or the person revoked
          // permission). Forget the endpoint so the next rest does not
          // pay for it again.
          if (error instanceof webpush.PushMessageError && (error.isGone() || error.response.status === 404)) {
            gone.push(sub.id);
          } else {
            failed++;
            // Kept on the response (which pg_net stores in net._http_response)
            // so a rejection by the push service can be read back from SQL.
            const detail = error instanceof webpush.PushMessageError
              ? `${error.response.status} ${(await error.response.text().catch(() => "")).slice(0, 200)}`
              : String(error).slice(0, 200);
            const host = new URL(sub.endpoint).host;
            errors.push(`${host}: ${detail}`);
            console.error("rest-push failed", host, detail);
          }
        }
      }),
    ),
  );
  failed += results.filter((r) => r.status === "rejected").length;

  if (gone.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", gone);
  }

  return json({ due: due.length, sent, failed, unsubscribed: gone.length, errors });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
