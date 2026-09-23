# Engine map

What each part of HealthApp does, which files hold it, and how finished it is.
Read [../CLAUDE.md](../CLAUDE.md) first for the conventions all of these follow
(single-branch Supabase actions, `ActionResult`, cookie i18n, RLS).

Maturity legend: **solid** = exercised against a live database, **unproven** =
the code is written and RLS-guarded but has never run against one, **stub** =
partially wired, **missing** = spec'd but not written.

Demo mode was removed on 2026-09-14, so "unproven" no longer has a working
fallback behind it — an unproven path is simply untested.

---

## Training

| | |
|---|---|
| Coach | `app/(coach)/programs`, `programs/new`, `programs/[id]` |
| Client | `app/(client)/workout` (every published program, coach's and own), `workout/[dayId]` (day overview + that day's history), `workout/[dayId]/log` (set logger), `workout/build` (solo builder) |
| Writes | [app/builder-actions.ts](../apps/web/app/builder-actions.ts) (incl. `removeProgramDay`), `createCustomExercise` in [library-actions.ts](../apps/web/app/library-actions.ts), `logSet` / `finishWorkout` in [client-actions-app.ts](../apps/web/app/client-actions-app.ts) |
| Reads | `getPrograms` / `getProgram` (data.ts), `getMyProgramGroups` / `getMyProgramDays` / `getWorkoutDay` / `getWorkoutDayHistory` / `getMySessions` / `getMyPrs` (client-data.ts) |
| Tables | `programs → program_days → program_exercises`; `logged_sessions → logged_sets` (`rpe` = felt intensity 1..10, `rir` = reps in reserve as typed, `notes` = per-set comment) |
| Components | `program-builder.tsx`, `exercise-picker.tsx` + `new-exercise-form.tsx`, `workout-day-list.tsx` + `swipe-to-delete.tsx`, `workout-history.tsx`, `set-logger.tsx` |

Coach builds program → days → exercises (sets/reps/rest/tempo/notes), can
duplicate a day, then publishes. Training lists every published program the
client holds (coach's first, then their own; `pickProgram` still decides which
one Today and adherence follow). Tapping a day opens its overview and the
history of past sessions of that day, set by set; "Start workout" goes to the
logger, where each set takes kg / reps / RIR, a 1–10 intensity slider and a
note. A day in the client's own program can be swiped left (or trashed with the
mouse) and deleted after confirmation. Anyone can create a custom exercise from
the picker (`exercises.owner_id` set, `source = 'custom'`). PRs are computed in
`packages/shared/src/prs.ts`.

**Maturity: solid.** Driven end-to-end against the live project on 2026-09-14 —
create a program for a client, add a day, add an exercise from the 888-row
library, set sets/reps/RIR/rest, publish, and confirm it reaches the client's
Today. RLS and column grants all held; `mutated()` guards every update/delete.

### Exercise page (added 2026-09-23)

`app/(client)/exercises/[id]` — one exercise as the signed-in person trained
it: lifetime bests (est. 1RM, heaviest set, best session volume, sessions; most
reps for a bodyweight exercise), a progress line with a metric switch
(`components/exercise-trend-chart.tsx`), rep records (heaviest load for at
least N reps, 1–12) and every session set by set. Math:
`packages/shared/src/exercise-history.ts` (Epley via `estimated1RM`, the PR
formula; `getMyPrs` now uses it too instead of a local copy). Read:
`lib/exercise-history-data.ts`, one wave on `logged_sets_history_idx`. Reached
from the library preview ("My history"), the PR list on Progress and exercise
names in a day's history. Chart and rep records are `progressCharts`, the list
follows `historyDays` — both open while the paywall is off. Not yet: warm-up
sets are counted like working sets (no set types), and a coach cannot open a
client's exercise page.

### Rest timer (added 2026-09-19)

| | |
|---|---|
| Client | The sticky bar under every `(client)` route (`components/rest-timer-bar.tsx`), the per-exercise rest chip in `set-logger.tsx`, the **Rest timer** card on `/account` and `/settings` (`components/rest-settings.tsx`) |
| Writes | [app/rest-actions.ts](../apps/web/app/rest-actions.ts): `saveRestPrefs`, `savePushSubscription` / `removePushSubscription`, `scheduleRestPush` / `cancelRestPush` |
| Math | [packages/shared/src/rest-timer.ts](../packages/shared/src/rest-timer.ts) — `startRest` / `pauseRest` / `resumeRest` / `extendRest` / `skipRest` / `settleRest`, `remainingMs`, `markRestNotified`, `plannedSets` / `nextPlannedSet` / `restBetween`, `resolveRestSeconds`, `restAfterLoggedSet` |
| State | `lib/rest-timer/client.tsx` (`RestTimerProvider`, mounted in `(client)/layout.tsx`), persisted in `localStorage` under `voinic-rest-timer-v1` (`lib/rest-timer/storage.ts`) |
| Tables | `users.rest_prefs` (jsonb: default, per-lift overrides, notify), `push_subscriptions`, `rest_pushes` — migration `20260919100000_rest_timer.sql`, pgTAP `rest_timer.test.sql` |
| Push | `public/sw.js` (push + notificationclick), `app/manifest.ts`, edge function `rest-push` (Web Push via `jsr:@negrel/webpush`), pg_cron `rest-push-tick` every 10 s → `tick_rest_pushes()` → `net.http_post` |

After `logSet()` succeeds — and only then — `restAfterLoggedSet()` decides
whether a rest starts: not after the workout's final set, not on a completed
day, and not between the members of one superset round (the rest comes after
the round). Duration: the person's override for the lift → the coach's
`program_exercises.rest_seconds` → the person's default (60 s; presets 30/45/
60/90/120/180 or custom 5–600). The timer is two epoch instants, `startedAt`
and `endsAt`; the UI ticks every 250 ms only to re-read `Date.now()`, and
`visibilitychange` re-settles it, so a phone that was locked shows the right
remainder the moment it wakes. Pause freezes the remainder; resume recomputes
`endsAt`; +15 s moves it; Skip ends it.

Completion is announced once per timer id (`notifiedAt`): an in-app banner
when the page is visible; a notification through the service worker when the
tab is hidden but alive; and, when the device is asleep, the server push —
scheduled as one `rest_pushes` row keyed by the timer id, claimed atomically
by `claim_due_rest_pushes()` before sending. No sound, no vibration anywhere
(`silent: true`, no `vibrate`); the OS and the person's settings have the
last word on that.

**Maturity: timer solid, push pipeline live.** The timer, settings and
permission flow were driven in the browser on 2026-09-19, and the same day the
server side was set up on the production project and exercised end-to-end
(due row → cron tick → `net.http_post` → function `200 {"due":1,…}` → row
marked sent): VAPID keys from `node scripts/vapid-keys.mjs`, function secrets
`VAPID_KEYS_JSON` / `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on Vercel,
`supabase functions deploy rest-push`, vault secrets `rest_push_url` /
`rest_push_key`. A new environment needs that list again. The function does
not compare the bearer against `SUPABASE_SERVICE_ROLE_KEY` (the injected
value no longer equals the legacy JWT once a project carries `sb_secret_`
keys); it uses the caller's bearer as its client key and lets the grant on
`claim_due_rest_pushes()` decide. What has *not* been observed yet is a real
device receiving one — the desktop app's browser pane denies notifications by
policy. Delivery latency is up to one tick (10 s). iOS delivers Web Push only
to a Home-Screen-installed app, which is why the manifest exists.

---

## Nutrition

| | |
|---|---|
| Coach | `app/(coach)/nutrition`, `nutrition/new`, `nutrition/[id]` |
| Client | `app/(client)/food` |
| Writes | [app/nutrition-actions.ts](../apps/web/app/nutrition-actions.ts) (coach side), `logFood` / `updateFoodLog` / `deleteFoodLog` / `toggleFavoriteFood` (client side) |
| Reads | `getNutritionPlans` / `getNutritionPlan`, `getMyDayNutrition` / `getMyPlanMeals` / `getMyFoodDays` / `getMyQuickFoods` (recent + starred, for the logger) |
| Tables | `foods`, `nutrition_plans → planned_meals → planned_meal_foods`, `food_logs`, `food_favorites` |
| Components | `nutrition-builder.tsx`, `new-plan-form.tsx`; client diary: `week-strip.tsx`, `nutrition-summary.tsx`, `meal-card.tsx`, `food-logger.tsx`, `food-entry.tsx`, `barcode-scanner.tsx` |
| Edge functions | `food-search`, `barcode-lookup` (+ `_shared/portions.ts`) |

**How a plan actually works.** The coach picks a client, names the plan, and sets
four daily targets (kcal, protein, carbs, fat). Creating the plan auto-inserts
four meal slots — breakfast, lunch, dinner, snack. The coach then fills each slot
with **real foods and gram amounts** searched out of the `foods` table; macros are
computed per-100g × grams and live plan totals sit next to the targets so the day
can be made to land on the number. Publish makes it visible to the client, who
sees it under each slot as "coach planned" next to their own log.

So it is **ingredient-based, not calories-only** — but see [GAPS.md](GAPS.md):
there is no per-weekday plan, no recipes, and no one-tap "ate as planned".

**Where food data comes from.** `foods` is a local cache. Custom foods are
owner-scoped; Open Food Facts rows are written by the edge functions on first use,
so the cache grows organically and the second person to scan a product pays
nothing. Two rules the schema enforces and that are easy to break by accident:

- `food_logs` **snapshots** name and macros at log time. External nutrition data
  changes; a client's history must not.
- `foods.portions` is a jsonb serving list (`[{label,grams,note,origin}]`) with a
  check constraint on its shape, and a `preserve_food_portions` trigger so a
  re-import can never wipe a curated range or overwrite a good value with an
  empty one. Grams are always **edible weight** (eggs are stored shell-off).

**Maturity: unproven** on the coach side (`nutrition-actions.ts`); the client
logging path is the most developed part of the app.

---

## Progress

| | |
|---|---|
| Client | `app/(client)/progress`, `app/(client)/check-in` |
| Coach | `app/(coach)/check-ins` |
| Writes | `addMeasurement`, `submitCheckIn` (client-actions-app.ts); `reviewCheckIn` ([actions.ts](../apps/web/app/actions.ts)) |
| Reads | `getMyMeasurements`, `getMyCheckInState`, `getMyPrs`; `getCheckIns` |
| Tables | `measurements`, `check_ins`, `progress_photos`, `adherence_snapshots` |
| Components | `measurement-form.tsx`, `check-in-form.tsx`, `check-in-review.tsx` |

Adherence is scored in `packages/shared/src/adherence.ts` — the versioned formula
from PRODUCT_SPEC §7 (`0.40·workout + 0.30·nutrition + 0.15·habits +
0.15·checkin`) that produces the on-track / needs-attention / at-risk signal on
the coach dashboard. **This formula must never be duplicated in a component.**

---

## Coaching

`app/(coach)/messages`, `messages/[id]`, `app/(client)/coach`. `sendMessage` in
actions.ts; `getConversations` / `getMessages` / `getMyCoachThread`. Tables
`conversations`, `messages`, `coach_feedback`. Component `message-thread.tsx`.
Plain threaded messaging — no realtime subscription yet, reads are server-rendered.

---

## Engagement

`app/(client)/habits`. `addHabit` / `toggleHabit`; `getMyHabits`. Tables `habits`,
`habit_logs`, `streaks`, `badges`, `user_badges`. Components `add-habit-form.tsx`
(seven suggested habits from `lib/habit-suggestions.ts`, each with a "what" and
"why" in both languages before it is added), `habit-ticks.tsx` (an ⓘ on habits
that match a suggestion by name unfolds the same text). Streaks and badges have tables and RLS but no award logic —
those are service-role engine tables with no insert policy, and nothing writes them.

**Fitness score** — one 0..100 activity number over the last 28 local days,
an aggregation of signals that already exist: `0.35 · training load +
0.25 · consistency + 0.20 · frequency + 0.20 · volume`. Training load is the
mean per-session score from `training-load.ts` on the same saturating curve;
consistency is active workout days / 16 (the streak day rule, in
`users.timezone`); frequency is completed sessions / 16; volume is total kg /
50,000 (an app reference, not a physiological claim). Fewer than 3 completed
workouts in the window is "building" — no number is shown. Math and the
previous-block trend: `packages/shared/src/fitness-score.ts`; the one read:
[lib/fitness-score-data.ts](../apps/web/lib/fitness-score-data.ts) (sessions +
sets under RLS, so a coach sees a client's and nobody sees anyone else's);
UI: `components/fitness-score.tsx`, Today card, `/fitness-score`, the coach's
client page. Derived, never stored; no migration, no RPC. It is an
application activity metric, not a health or fitness assessment.

**External workout sharing** (Instagram Stories etc.). A completed session
becomes a 1080×1920 (Story) or 1080×1080 (Square) PNG drawn on a canvas in
the browser — nothing is stored. `lib/share-card.ts` (pure: the card is the
feed's `workoutPostPayload` snapshot + PR lines + author; `layoutShareCard`
places every element, absent stats leave no block) and `lib/share-card-render.ts`
(canvas painter, brand fonts via `--font-exo2` / `--font-inter`, Web Share API
with Save Image fallback). `lib/share-card-data.ts` builds the card server-side
through `getShareableSession` (owner-scoped); `app/share-card-actions.ts` is the
one action, taking a session id only. `components/share-workout.tsx` is the
button + preview dialog (format, Edit Stats, Show/Hide profile). Entries: the
done page (the session just finished), history rows on the day page, and
Today's "Last workout".

---

## Accounts, billing, admin

| | |
|---|---|
| Routes | `app/login`, `app/reset-password`, `app/auth/callback` (route handler), `app/(coach)/settings`, `app/(admin)/admin/*`, `app/(client)/billing` |
| Writes | [billing-actions.ts](../apps/web/app/billing-actions.ts) — `startCheckout`, `openBillingPortal`, `adminSetTier`; `createInvite` |
| Tables | `users`, `trainer_clients`, `subscriptions` |
| Migrations | `..._subscriptions.sql`, `..._admin_role.sql`, `..._stripe_billing.sql`, `..._signup_role.sql` |
| Edge function | `stripe-webhook` |
| Email templates | `supabase/templates/{confirmation,recovery}.html` — bilingual; wired in `config.toml` locally, pasted by hand into the hosted dashboard |

**Auth is email + password, or Google.** The login page has three modes: sign
in, create account (full name, username, sex, age, coach/client choice,
password ≥ 8 + repeat — username / sex / birth year land in `users` through the
trigger, migration `20260910100000`; accounts without a username are sent to
`app/complete-profile`), and forgot password; the first two also offer "Continue with Google"
(`signInWithOAuth`). Email sign-up passes `{ full_name, role }` as user
metadata; the `handle_new_user` trigger accepts only `coach`/`client` and
defaults everything else to `client`, so a sign-up request can never mint an
admin (`supabase/tests/signup_role.test.sql`). Google cannot carry metadata, so
the choice rides on the callback URL as `?role=` and the callback calls
`claim_signup_role()`, which only acts on a row created in the last 10 minutes
(`role_not_self_service.test.sql`) — or, since `20260917100000`, on a row whose
`username` is still null, because the "sign in" tab's Google button creates
accounts with no role choice at all and `/complete-profile` is where they are
first asked (`profile_extras.test.sql`). The complete-profile action claims the
role *before* writing the username, since the username closes that window. The same migration makes the `users`
update grant column-level — `role` is not on it, so nobody can PATCH their own
role over REST. Emailed links and the OAuth return both land on
`/auth/callback`, which verifies a `token_hash` (our templates) or exchanges a
PKCE `code` (Supabase's default templates and OAuth) and continues to `next`.
Supabase's English auth errors are mapped to locale strings in
`lib/auth-errors.ts`. If the project has email confirmation on, sign-up shows a
"check your inbox" state instead of redirecting. Google needs the provider
enabled per project (dashboard for hosted, `config.toml` + env vars locally).
No Apple, no onboarding — see GAPS.

**Entitlements live in one table.** `subscriptions` stores only who has which tier
(`free`, `premium`, `coach_free`, `coach_pro`); tier → feature mapping is code in
`packages/shared/src/entitlements.ts`. Every new profile gets a row via the
`on_profile_created` trigger, and `effective_tier()` folds the 30-day trial in, so
a trialling user reads as their paid tier without a payment record. Stripe is
wired (checkout + portal + webhook); monthly and ~15%-off annual prices, and an
admin can grant a tier directly with `admin_set_tier`.

**Paywall (2026-09-23, built and switched off).** Migration
`20260923120000_paywall.sql`, test `supabase/tests/paywall.test.sql` (17
assertions, run live inside a rolled-back transaction before applying).

- *The switch* is `app_flags.paywall` (`enabled`, plus `preview_users uuid[]`
  to turn it on for a few accounts first). Off — the state it shipped in — every
  gate is open: `planEntitlements()` answers the role's full paid set, the limit
  triggers let everything through, `/billing` still redirects to `/account` and
  the coach settings hide the subscription card. Only the roster cap (3 / 30 in
  `create_invite`) applies either way, as it always has.
- *Tiers.* `own_tier()` is the old `effective_tier()` plus one fix (a coach
  whose trial ended is `coach_free`, not `free`). `effective_tier()` now gives a
  plain client **Premium while their active coach's own tier is `coach_pro`**.
  Mirrored in `effectiveTier()` (`packages/shared/src/billing.ts`).
- *What the app reads.* `getProfile` selects the definer view `my_plan`
  (effective tier, own tier, `paywall`, trial, `has_stripe`) in place of the old
  `subscriptions` select — same wave. `lib/plan.ts` `getPlan()` turns it into
  `{ e: Entitlements, historySince, upgrade }`; both layouts mount it for client
  components as `PlanProvider` / `usePlan()` (`lib/plan-client.tsx`).
- *Limits SQL enforces* (`plan_limit()` mirrors `ENTITLEMENTS`, pinned by
  `entitlements.test.ts`): own programs, custom exercises, favourite foods via
  the `enforce_plan_limit` trigger, and barcode scans per local day via
  `claim_barcode_scan()` (called by `lookupBarcode` beside the cache read). Each
  raises `PLAN_LIMIT_REACHED`; screens show `UpgradeHint` (`components/upgrade.tsx`).
- *Gates checked in app code* — display of the person's own data, or a Pro
  control in a server action: history window (30 days of sessions, day history,
  weigh-in list, photos, food diary), progress charts + full PR list +
  fitness-score trend/breakdown, photo comparison, share-card customisation,
  setting your own exercise video, coach adherence signal/reason/% and a
  client's fitness score, duplicating a day and **Copy to client** (new, in the
  program builder: `copyProgramToClient`), ingredient-based meal plans
  (`addPlanFood`). Headline counts (sessions, volume, PRs) always count
  everything, so the coach's and client's numbers never disagree.
- To preview: `update public.app_flags set preview_users = array['<uuid>']::uuid[] where key = 'paywall';`
  — note the seeded test accounts are all on trials or manual grants, so a
  gate only shows once their `subscriptions` row is free and the trial is past.

**Admin panel** (`app/(admin)/admin/*`, 2026-09-20). Read-mostly operations
desk: `lib/admin/data.ts` wraps one `admin_*` RPC per page; each RPC is
`security definer` and opens with `admin_assert()` (raises `42501` unless
`is_admin()`), so the `/admin` prefix is a view, not the boundary. Email, last
sign-in and provider come from `auth.users` / `auth.identities` only through
those RPCs; **login history from `public.admin_login_events`** — a view over
the USER_LOGIN audit rows, because `auth.audit_log_entries` is empty on a
hosted Supabase project and every login figure in the panel read 0 until
20260922100000 (it falls back to GoTrue's log only while our own stream is
empty, which is the local stack). `admin_audit_events`
is an append-only stream written by triggers on users, auth.users
(`last_sign_in_at`), trainer_clients, programs, logged_sessions, logged_sets,
exercises, challenges, social_*, push_subscriptions and
account_deletion_requests, plus the admin actions themselves; a `before update
or delete` trigger refuses edits from every API role. Failed password sign-ins
are reported by the login form through `record_login_failure()` (anonymous,
flood-capped). Admin writes: `admin_set_suspended` (sets `users.suspended_at`;
both app layouts redirect a suspended account to `/suspended`),
`admin_revoke_invitation`, `admin_delete_post` (soft), `admin_remove_push_subscription`,
`admin_set_tier` (now audited), `admin_resolve_app_error`. Tests:
`supabase/tests/admin_panel.test.sql` (101 assertions), `lib/admin/params.test.ts`.

**Application errors** (`/admin/errors`, `app_errors`, 2026-09-22). The panel's
"Application errors" tile used to be an honest dash; there is a store now.
`app/error.tsx`, `app/global-error.tsx` and `(admin)/error.tsx` each mount
`components/error-reporter.tsx`, which calls `reportAppError`
(`app/error-actions.ts`) → `record_app_error()` — security definer, callable by
anon (an error boundary fires for a signed-out visitor too) and capped at 20
rows an hour per user, 40 per address. The row holds the message, the Next.js
digest, the route, a trimmed stack, the user agent and the IP; never a form
value, a token or a request body. Reads go through `admin_app_errors()`, which
returns the counters, the distinct messages ranked by frequency, and one page of
raw rows; `admin_resolve_app_error(id, all_alike)` marks rather than deletes.
Nothing reports server-side failures that never reach a boundary — a caught
error in a server action is still only a console line.

One active coach per client is enforced by `trainer_clients` + invite codes
(`create_invite()`), and it is what `is_active_coach_of()` — and therefore every
coach-side RLS policy — keys off.

---

## Cross-cutting

- **Onboarding surfaces:** landing `app/page.tsx`, `get-the-app`, `privacy`,
  `terms`, `cookie-banner.tsx`, `language-selector.tsx`.
- **Sync:** `supabase/functions/sync-ingest` + `packages/shared/src/sync.ts` —
  the offline outbox endpoint for the mobile app that does not exist yet.
  Append-only entities dedupe on `client_generated_id`, conflicts are
  last-write-wins by `client_ts`.
- **Push:** `supabase/functions/push-dispatch`. No client registers a token.
- **Exercise library:** `app/(coach)/library`, `lib/exercise-library.ts`,
  `supabase/functions/import-exercises`.
