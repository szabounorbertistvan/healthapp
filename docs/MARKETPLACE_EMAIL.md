# Marketplace email — design (nothing sends yet)

Status 2026-10-11: **implemented locally, not active, nothing sends.** Provider: **Brevo** (chosen 2026-10-11, replacing the Resend draft). Auth email
(confirm sign-up, reset password) is a separate path, owned by Supabase Auth —
see docs/ENGINES.md §Accounts.

| Piece | Where | State |
|---|---|---|
| Policy: rules, preferences, send/skip/wait, links, retry | `packages/shared/src/marketplace-email.ts` | done, unit-tested; link parity with the in-app notice tested |
| Provider (Brevo transactional API, swappable interface, config validation) | `supabase/functions/_shared/email/provider.ts` | done, tested with a mocked fetch |
| RO/EN templates, Voinic branding | `supabase/functions/_shared/email/templates.ts` | done, tested (escaping, no message text or sender, both languages for every rule) |
| Dispatcher core + HTTP handler | `supabase/functions/_shared/email/dispatch.ts` | done, tested with a mock store and provider |
| Edge function | `supabase/functions/marketplace-email-dispatch/index.ts`, `verify_jwt = true` in `config.toml` | wired, **not deployed**; without the outbox it answers 500, without secrets 503 |
| Outbox table, enqueue trigger, claim/peek/mark RPCs, cron tick | `supabase/migrations/20261114100000_email_outbox.sql` + `supabase/tests/email_outbox.test.sql` | **migration** (approved 2026-10-11); the `marketplace-email-tick` cron job is created **inactive**; the enqueue trigger never blocks a notification (an error becomes a warning); SQL rule list held equal to the TS rules by `apps/web/lib/email-outbox-rules.test.ts` |
| Preferences UI | `components/email-settings.tsx` (`EmailPrefsCard` on `/account` and the coach's `/settings`), `app/email-actions.ts` (`saveEmailPref`), helpers `EMAIL_PREF_CATEGORIES` / `emailPrefsState` / `withEmailPref` in the shared module | done 2026-10-11; unit + e2e (`e2e/email-prefs.spec.ts`); "Your coach page" only for someone who coaches; push switches (top-level keys) preserved |
| Unsubscribe links | `supabase/migrations/20261115100000_email_unsubscribe.sql` (signing key generated **inside the database**, `email_unsubscribe_token()` signs in `email_outbox_rows()`, `email_unsubscribe()` the anon door that verifies), `/unsubscribe` (page + button, nothing changes on GET), `/unsubscribe/one-click` (RFC 8058 POST, the `List-Unsubscribe` header), footer link in every template; the dispatcher skips (`no_unsubscribe`) any email without a token | done 2026-10-11; pgTAP `email_unsubscribe.test.sql` (16), unit tests for links, headers, footer |
| Admin `failed` count | — | not built |

The Vitest suite includes `supabase/functions/_shared/**/*.test.ts`; `deno check`
covers the function and its tests.

## 1. What exists today

| Piece | Where | Relevant facts |
|---|---|---|
| `notifications` | `20260823000700_engagement.sql` | `id, user_id, category, title, body, payload jsonb, created_at, sent_at, read_at`. Owner-only RLS, **no insert policy** — only security-definer functions write it. `title`/`body` are English; the app renders its own sentences from `category` + `payload.event`. |
| Writers | `coach_request_notify`, `booking_notify`, `message_notify` (trigger), `review_notify`, `marketplace_notify`, `coaching_notify` | Each runs `social_notify_ok()` first (recipient live, not deleting, not blocked, not the actor) — except `marketplace_notify`, which only checks the user exists. One row per event, per recipient. `message_notify` keeps **one unread row per conversation**. |
| Reminders | `detect_booking_reminders()`, pg_cron `booking-reminders` every 15 min | Claims `bookings.reminded_at` in the same `UPDATE … RETURNING`, so a booking is reminded once; writes one row to each side. |
| `push-dispatch` | `supabase/functions/push-dispatch` | Expo push. **Not scheduled** (no cron in any migration) and unused (no app writes `push_token`). When run it sets `sent_at` on every row it reads — pushed **and skipped** — so `sent_at` cannot be reused to track email. |
| `rest-push` | `supabase/functions/rest-push`, `tick_rest_pushes()` | The working pattern for a service-only function: pg_cron → `net.http_post` with URL + service key from **Vault** (`rest_push_url`, `rest_push_key`), the function uses the caller's bearer as its database key and relies on the service-only grant of its claim RPC (comparing the bearer to `SUPABASE_SERVICE_ROLE_KEY` returns 403 on this project — the Vault key is a valid service-role key but not byte-equal to that variable), the row is claimed before sending. `marketplace-email-dispatch` does the same since 2026-10-11. |
| Preferences | `users.notification_prefs jsonb default '{}'` | Writable by the owner (column grant), **no UI**. push-dispatch reads `prefs[category] === false` as "off". Nothing about email. |
| Email addresses | `auth.users.email`, `email_confirmed_at` | `public.users` has no email column. Only the service role can read them. |
| Locale | `users.locale` | For RO/EN email text. |

## 2. Integration point

**The `notifications` row is the event.** Every marketplace event already
produces exactly one row per recipient, after the guard. Emails derive from
those rows, never from a second set of triggers: one row → at most one email,
keyed by `notifications.id`. Hooking the domain functions directly would
duplicate the guard and the event list.

## 3. Event map (first release)

Recipient = `notifications.user_id`. Link = `marketplaceEmailPath()` (equal to
the in-app link, enforced by the parity test). Content = recipient name, the
other person's display name, the event, the date/time where there is one, the
link. **Never** message text, health data, review text, notes or prices.

| # | Event (category / payload.event) | Recipient | Fires | Kind | Link | Do not send when |
|---|---|---|---|---|---|---|
| 1 | `coaching_request` / `sent` | coach | client sends a request | operational | `/requests` | guard failed (no row); coach opted out |
| 2 | `coaching_request` / `accepted`, `declined`, `started` | client | coach answers / starts coaching | operational | `/coaches/requests`, `/coach` | — |
| 3 | `booking` / `booked`, `requested` | coach | client books (instant / needs approval) | operational | `/bookings` | — |
| 4 | `booking` / `confirmed`, `declined`, `cancelled` | the other side | coach answers; either side cancels | operational | `/coaches/bookings` or `/bookings` | older than 24 h |
| 5 | `booking` / `reminder` | both | session within 24 h, booked > 1 h ago | operational | as 4 | older than 6 h (session may be over) |
| 6 | `new_message` | the other party | first unread message in a thread | **optional** | the thread | not switched on; read in-app within the 15-min hold |
| 7 | `review` / `published`, `response` | coach / reviewer | review published / answered | **optional** | `/reviews`, `/coaches/<slug>#reviews` | not switched on |
| 8 | `marketplace` / `profile_published`, `profile_returned`, `revision_approved`, `revision_returned` | coach | admin decision | operational | `/settings/coach-profile` | — |

Every row is also skipped when the recipient has no email, an **unconfirmed**
email (Confirm email was off in production until 2026-10-19, so every account made
before then counts as confirmed — an unverified address may belong to someone else),
an address on a reserved test domain (`.test`, `.example`, `.invalid`, `.localhost` —
the seeded test accounts; mailing them would bounce at Brevo), is suspended or has asked for deletion. These are
re-checked **at send time** (`marketplaceEmailDecision`), not at enqueue time.

In-app only on purpose: a request the client cancelled, `booking/completed`
(the review prompt), coaching paused/resumed/ended, `review_hidden`,
verification outcomes, every social category.

## 4. Proposed flow

```
domain RPC / trigger
  └─ *_notify()  ── social_notify_ok() ──▶ INSERT notifications            (exists)
                                              │
                                              ▼ AFTER INSERT trigger         (proposed)
                                   rule exists for (category, event)?
                                     no ─▶ nothing (in-app only)
                                     yes ─▶ INSERT email_outbox
                                            (notification_id UNIQUE, status 'pending',
                                             not_before = created_at + delay)
                                              │
pg_cron every minute ── net.http_post (Vault URL + key) ──▶ marketplace-email-dispatch   (proposed)
                                              │   bearer = DB key; email_outbox_peek granted to service_role only → else 403
                                              ▼
                                   claim batch: UPDATE … SET status='sending', locked_until
                                     WHERE status in ('pending','retry') AND not_before <= now()
                                     … FOR UPDATE SKIP LOCKED  RETURNING …   (RPC, service role)
                                              │
                                   per row: read recipient (auth.users email + confirmed,
                                     users.locale/prefs/suspended, deletion request)
                                     ── marketplaceEmailDecision() ──
                                       skip ─▶ status 'skipped', reason
                                       wait ─▶ not_before = until
                                       send ─▶ Brevo API, idempotencyKey = notification id (a UUID)
                                                 2xx ─▶ 'sent', provider_message_id
                                                 retry ─▶ attempts+1, not_before += backoff
                                                 permanent / attempts exhausted ─▶ 'failed'
```

**Recommendation: a dedicated edge function `marketplace-email-dispatch`**
calling the Brevo transactional HTTP API, `POST /v3/smtp/email` (not SMTP: an HTTP API gives an idempotency key and
clear status codes). It follows the `rest-push` pattern exactly, so there is no
new security model:
- not callable anonymously: `verify_jwt = true` *and* the bearer must equal the
  service role key; it takes **no recipient, subject or body from the request**
  — it only reads its own outbox, so it cannot be used to send arbitrary mail;
- `BREVO_API_KEY` only in Supabase Secrets; the function URL/key only in Vault;
- logs: notification id, category, event, status, provider status code — never
  an email address, name or body.

## 5. Why a separate outbox (proposed table)

`notifications` cannot safely carry delivery state:
- `sent_at` already means "push-dispatch handled it" and is set on skipped rows;
- it has no attempts, next-attempt time, lock, provider id or error;
- deleting a notification (account purge cascades) must not lose the audit of
  what was sent — and an outbox row must go with the account too (cascade).

Created by `20261114100000_email_outbox.sql`: `email_outbox(id, notification_id uuid unique references
notifications on delete cascade, user_id, status check in ('pending','sending',
'sent','retry','failed','skipped'), reason, attempts int, not_before, locked_until,
provider_message_id, last_status int, created_at, updated_at)`, RLS on with **no
policies** and no grants (service role only), plus a pgTAP suite.

| Concern | Handling |
|---|---|
| Duplicates | `UNIQUE(notification_id)` (one email per row, even if the trigger fires twice); Brevo `idempotencyKey` (in the body's `headers`, must be a UUID) = `marketplaceEmailIdempotencyKey(id)` = the notification id, so a retry after a timeout cannot become a second email — Brevo answers a repeat with `duplicate_parameter`, which the provider reports as 208 (sent). Brevo keeps a key **30 minutes**: retries 1–3 (at +1, +6, +21 min) are covered, the 4th (+81 min) is not, so only a timed-out attempt followed by that late retry could ever double-send; claim with `FOR UPDATE SKIP LOCKED` + `locked_until` (two overlapping runs never take the same row). Message spam is already bounded by `message_notify` (one unread row per thread) plus the 15-min hold. |
| Retries | only for `retry` statuses (0/network, 408, 409, 425, 429, 5xx); backoff 1, 5, 15, 60 min; `EMAIL_MAX_ATTEMPTS = 5`. A row stuck in `sending` past `locked_until` returns to `retry`. |
| Permanent errors | 400/401/403/404/422 → `failed`, no retry. A 401/403 means a bad key: alert a person, do not burn the queue (pause the cron). |
| Provider limits | batch size ≤ the plan's per-second limit; 429 → retry with backoff; a daily cap counter before the plan's daily limit (Brevo free plan: 300 emails/day — check current terms; a 402 `not_enough_credits` is permanent and needs a person). |
| Must not be resent | anything `sent`; anything older than the rule's `maxAgeMinutes` (a reminder after the session, a stale booking change after an outage) → `skipped/stale`. |
| In-app exists, email failed | the notification stays in the app (it is the source of truth); the outbox row ends `failed` with the status; nothing retries a `failed` row automatically. Admin visibility: a count of `failed` in `/admin/system` (proposed). |

The outbox is a migration since 2026-10-11, so these hold wherever it is applied; nothing sends until the switches in §8 are on.

## 6. Preferences and GDPR

- **Operational** (rows 1–5, 8): part of a service the person requested — a
  booking, a request, their own listing. Lawful basis: contract / legitimate
  interest. Sent by default, **one-click opt-out per category**.
- **Optional** (rows 6–7): helpful, not needed. **Off until switched on.**
- **Marketing** (newsletters, promotions, "coaches near you"): not part of this
  system at all; needs separate, explicit, recorded consent and its own
  unsubscribe — do not route it through `notifications`.
- An in-app notification never implies consent to email; a push switch is not
  an email switch (`emailCategoryEnabled` reads only `notification_prefs.email`).
- Minimal model, **no schema change**: `users.notification_prefs.email.<category>
  = true|false`, inside the jsonb the owner can already update. Needed before
  launch: ~~a settings UI (on `/account` and the coach's `/settings`)~~ and ~~a signed
  unsubscribe link in every email + the `List-Unsubscribe` header~~ — both built
  2026-10-11. The token is HMAC-SHA256(user id + ":" + category) truncated to 128
  bits, keyed by `email_signing_key` — a key the migration generates in the
  database and that never leaves it, so there is no unsubscribe secret to set.
- Data minimisation: no message text, no health data; the outbox stores no
  address (read at send time). Privacy policy must name the email provider as a
  processor (Brevo — Sendinblue SAS, France, EU-hosted; sign its DPA) before the first send.
- Account deletion: outbox rows cascade with the notification/user.

## 7. Secrets and configuration (implementation stage)

| Name | Where | Purpose |
|---|---|---|
| `BREVO_API_KEY` | Supabase Secrets | Brevo API key (SMTP & API → API keys); restrict it to the Supabase egress if the plan allows IP allow-listing |
| `EMAIL_FROM` | Supabase Secrets | e.g. `Voinic <notificari@voinic.fit>` |
| `SITE_URL` | Supabase Secrets | `https://www.voinic.fit`, prefixed to `marketplaceEmailPath()` |
| `EMAIL_DISPATCH_ENABLED` | Supabase Secrets | `true` to send; anything else allows only `{"dry_run": true}` |
| `marketplace_email_url`, `marketplace_email_key` | Vault | function URL + service key for the cron tick (as `rest_push_*`) |
| `SUPABASE_URL` | provided by Supabase | function → database (the key is the caller's bearer) |

None of these go in the repo, Vercel or the browser.

## 8. Before switching it on

Manual steps, in order (the function imports `packages/shared/src/marketplace-email.ts`
from outside `supabase/functions/`: confirm the CLI bundles it with
`supabase functions deploy marketplace-email-dispatch --dry-run` or a staging
deploy before relying on it; if not, vendor that one file into `_shared/`):
1. ~~Brevo account; authenticate the sending domain `voinic.fit`; Supabase Auth custom SMTP through Brevo (`smtp-relay.brevo.com`, port 587, SMTP key)~~ — done by the owner in the dashboards, 2026-10-10. Still open here: create a Brevo **API key** (separate from the SMTP key) for `BREVO_API_KEY`, confirm the sender address the dispatcher will use in `EMAIL_FROM`, and paste `supabase/templates/{confirmation,recovery}.html` into Dashboard → Authentication → Email Templates if not done yet. Never `supabase config push` for this.
2. ~~Approve §9; write the migration (outbox + enqueue trigger + claim/mark RPCs + cron, cron **disabled**) with a pgTAP suite~~ — done 2026-10-11 (`20261114100000_email_outbox.sql`, 21 pgTAP assertions).
3. ~~Write `marketplace-email-dispatch` + RO/EN templates~~ — done (2026-10-09); `deno check` passes; `verify_jwt = true` is in `config.toml`.
4. `supabase secrets set …` (§7); `supabase functions deploy marketplace-email-dispatch`; Vault secrets.
5. Dry run: POST `{"dry_run": true}` with the service key — the function reports each decision (`would_send`, `skipped`…) without calling Brevo or changing a row (`email_outbox_peek`).
6. Switch the cron on — `select cron.alter_job((select jobid from cron.job where jobname = 'marketplace-email-tick'), active := true);` — and watch `sent`/`failed` counts.

Tests required before production:
- pgTAP: trigger enqueues exactly the mapped rows, once; claim is exclusive under two concurrent sessions; RLS — no role but service can read the outbox; cascade on account purge.
- Unit (exists): rules, preferences, decision, links, retry classification.
- Function (Deno, mocked fetch): forbidden without the service key; idempotency key sent; 429 → retry, 422 → failed, network error → retry; no address in logs.
- One real end-to-end per event to a test inbox outside the team, RO and EN, Gmail + Outlook, spam folder checked; unsubscribe link works.

## 9. Approvals (granted by the owner 2026-10-11)

1. ~~Adding the `email_outbox` table + trigger (schema change)~~ — approved, migrated.
2. ~~The kind of each event (operational vs optional) and the defaults in §6~~ — approved as designed.
3. ~~Provider~~ — Brevo, decided 2026-10-11; still open: the plan (free 300/day vs paid), the DPA, the sending address.
4. ~~Hold time for messages (15 min) and the stale limits~~ — approved as designed.
5. Failures are seen by an admin (a `failed` count on `/admin/system` — approved, not built yet); alerting on a bad key is not built.
