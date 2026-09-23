# Gaps — spec vs. code

`PRODUCT_SPEC.md` and `DEVELOPMENT_PLAN.md` describe the intended product.
This is the honest diff against what is in the repo, so a future session doesn't
assume a feature exists because the spec (or the landing page) says it does.

Verified 2026-08-26; landing-page claims re-audited and several entries closed 2026-09-16.

## Structural

**No mobile app.** The plan's `apps/mobile` (Expo) does not exist. Every "client
app" screen is a web route in `apps/web/app/(client)/`. Three things are built
for it and unused: `supabase/functions/sync-ingest` (offline outbox),
`supabase/functions/push-dispatch` (`users.push_token` is never written by any
client), and `packages/shared/src/sync.ts`.

**The nutrition builder is partly proven — 2026-09-19.** Driven against the live
project as coach Andrei: `addPlanFood`, `removePlanFood` and
`publishNutritionPlan` all work, and the client then reads the plan under RLS
(verified both for a targets-only plan and for the seeded plan with 14 foods).
Still not exercised end-to-end: `createNutritionPlan`, `updatePlanFoodGrams`,
`addMealDayVariant` / `removeMealDayVariant`. The header comment in
`nutrition-actions.ts` is correspondingly narrower now.

**Tests cover only domain math.** Vitest is scoped to
`packages/**/src/**/*.test.ts`. Nothing tests a component, a server action, or a
route. The one integration-level safety net is the pgTAP RLS suite
(`supabase/tests/rls_client_isolation.test.sql`, `signup_role.test.sql`,
`role_not_self_service.test.sql`) run in CI.

**No Apple sign-in, no onboarding.** Spec C1 promises email + Google + Apple
and an onboarding flow. Email + password and Google exist (sign-up, repeat
password, forgot/reset password, coach/client choice). Apple is required by the
App Store once any social login ships in a native app, and would be one more
`signInWithOAuth` provider redirecting to the existing `/auth/callback`. After
sign-up a user lands straight on their home screen with default units, locale
and check-in day — nothing asks.

## Nutrition

**1. ~~A plan is a single day, repeated forever~~ — closed 2026-09-16.**
`planned_meals.day_index` (`0 = every day, 1..7 = ISO weekday`) is now written
and read. The coach's builder offers "different on one day", which copies a meal
with its foods onto that weekday; the everyday version keeps covering the rest.
The client's diary resolves the day it is showing — browsing back to Saturday
shows Saturday's plan — and "ate as planned" logs the same resolution. The rule
is `mealsForWeekday` in `packages/shared/src/meal-days.ts`, with tests, because
the diary, the coach preview and the log must not disagree. Spec W6's
"duplicate day" for the plan builder is still only in the *program* builder.

**2. No recipes or composite foods.** A meal is a flat list of raw ingredient
rows. A coach who wants "chicken bowl" in five plans re-adds chicken + rice + oil
+ broccoli five times. There is no saved recipe entity that expands into
ingredients or logs as one item. See [DISHFINDER.md](DISHFINDER.md) — the sibling
project already holds 52k ingredient-indexed recipes.

**3. ~~No "ate as planned"~~ — closed 2026-09-16.** `logPlannedMeal` in
`app/client-actions-app.ts` re-reads the published plan server-side and logs the
whole slot in one tap; the button sits in `components/meal-card.tsx` and only
shows while the slot is still empty. Idempotent — `client_generated_id` is
derived from (user, day, slot, position), so a double tap upserts rather than
duplicating. Still missing from the C8 quick-actions row: recents, favourites,
copy-yesterday.

**4. One live plan per client.** `getMyPlanMeals` takes the single most recent
`published` plan. No date ranges, no history, no training-day vs rest-day
switching.

**5. No custom food form.** Spec C12. `foods` supports owner-scoped custom rows
and the schema is ready; there is no UI to create one, so a barcode miss
funnels to search and stops there.

## Engagement

**Badges have a table and RLS but no logic** — nothing writes `badges`, and no
screen reads it. Streaks *are* live, but derived on the fly from completed
sessions (`lib/streak-data.ts`, `packages/shared/src/streaks.ts`), not from the
`streaks` table. `adherence_snapshots` is the same story as badges: the formula
exists in `packages/shared`, the scheduled job that materialises weekly
snapshots does not.

## Coaching

**No realtime.** No Supabase channel subscription exists anywhere in the web app.
Messages and the kitchen-style live surfaces are all server-rendered reads
refreshed by `router.refresh()`.

**`coach_feedback` is half-wired.** The coach *does* write it: `reviewCheckIn`
(`app/actions.ts`) inserts a `check_in` row when the coach types a reply. Until
2026-09-16 no client screen ever read it — `getMyCheckInState` returned
`coach_feedback: null` hardcoded, so every reply a coach wrote was discarded on
arrival while the UI that displays it sat there in `/check-in` and `/today`.
Now read (one extra parallel query, no extra wave). **Per-set and per-session
feedback still do not exist** — nothing writes `reference_type` `set`,
`session` or `set_video`, so the landing page no longer claims it.

## Paid tiers and the landing page

**`ENTITLEMENTS` is a table of intentions, not of shipped features**
(`packages/shared/src/entitlements.ts`). Only `maxClients` has code behind it —
`create_invite` raises `CLIENT_LIMIT_REACHED` at 3 / 30. `progressPhotos`,
`advancedAnalytics` and `customExerciseVideos` are read by nothing: **no client
screen gates on an entitlement at all**. Two of the three have since shipped as
*free* features — exercise videos (YouTube links; on 2026-09-23 widened from
the owner's custom rows to anyone on any exercise, via `exercise_video_links`) on 2026-09-16 and
progress photos the same day — because neither is something a competitor
charges for; the flag stays in the table as an intention nobody honours. So a paying `premium` client gets
nothing a free one does not, and `coach_pro` buys only the bigger roster.
The landing page and the checkout panel now mark those three with a "soon"
badge instead of a tick (2026-09-16).

**No offline anything.** No IndexedDB, no outbox — the web app simply fails
without a connection, and `sync-ingest` / `packages/shared/src/sync.ts` remain
unused. The landing page claimed "offline logging" until 2026-09-16. There *is*
a service worker since 2026-09-19 (`public/sw.js`), but it exists only for the
rest timer's Web Push and caches nothing — a rest already counting down keeps
counting offline, that is all.

**Rest-timer push: pipeline live, device delivery unobserved.** The Web Push
path (migration `20260919100000`, edge function `rest-push`, cron
`rest-push-tick`) was fully set up on production on 2026-09-19 and driven
through to the function claiming a due row. No real phone has yet been seen
receiving one (the dev browser pane denies notifications); the first person
to enable notifications on `/account` from a normal browser will be that
test. `push-dispatch` (Expo) remains unused — the web push is a separate,
smaller path.

**~~No GDPR export or account deletion~~ — closed 2026-09-16.** `/account` carries
both: `downloadMyData` (lib/data-export.ts) hands the browser one JSON file with
every row the account owns, and `requestAccountDeletion` calls the
`request_account_deletion()` RPC that has sat unused since migration
`20260823001200`. The purge job is migration `20260916110000_account_purge.sql`:
`purge_deleted_accounts()` on a daily cron, plus a tightened
`request_account_deletion()` that also replaces the searchable username.
**That migration has not been applied to the live project yet** — until it is,
a deleted account is still only hidden. Covered by
`supabase/tests/account_purge.test.sql`, which also pins the case that made a
naive delete impossible: a coach's custom exercise sitting inside a client's
program (`program_exercises.exercise_id` has no cascade), so the job reassigns
those exercises to the system library instead of letting them cascade.

**~~No client settings screen~~ — `/account` shipped 2026-09-16** with name,
username, time zone, check-in weekday and leaderboard visibility. The last one
mattered most: `users.leaderboard_visibility` defaults to `'public'` in SQL and
the migration that added it says "No UI", so every client was ranked publicly
without ever choosing to be.

**Units shipped 2026-09-16.** `weight_unit` / `length_unit` are honoured
everywhere a weight or a circumference is shown or typed. The rule is in
`packages/shared/src/units.ts` with tests: storage stays metric and conversion
happens only at the edges, so no sum, chart or leaderboard has to know which
unit a row was entered in. The client shell carries a `UnitsProvider`
(`lib/units/client.tsx`) shaped like the i18n one; server components read the
unit off the profile instead.

The inputs mattered more than the displays — the set logger, the set editor,
the weigh-in, the check-in, the feed's weight box and the program builder all
convert on the way in, and the logger's pre-filled coach target converts on the
way out, which would otherwise have put 100 into a pound box and logged 45 kg.

Still without a control: `notification_prefs`. **Coach surfaces remain metric** —
the coach shell has no UnitsProvider, so the default applies there.

**`/get-the-app` is orphaned** — nothing links to it, and it described an Expo
app that does not exist. Rewritten 2026-09-16 to describe the web app.

**`ClientToday.unread_from_coach` is hardcoded `0`** (`lib/client-today.ts`) and
read by no component — dead either way.

**Challenges and leaderboards, 2026-09-16.** Clients can now create their own
challenges (`createChallenge`): the schema and its policies supported it from
the start — `creator_id`, `visibility`, `challenges_owner_insert` — only the
form was missing, so the four seeded platform challenges were all anyone could
join. Leaderboards gained a `following` scope, which needed migration
`20260916120000_leaderboard_following.sql` because `social_leaderboard()`
validated `p_scope` against `'global'` alone. The scope narrows the visible set
and never widens it: someone private stays off the board even if you follow
them. **Not applied to the live project yet.** `club` and `gym` scopes are still
unbuilt.

**Progress photos shipped 2026-09-16.** Storage is Cloudinary
(`lib/cloudinary.ts`), not Supabase Storage. Assets are `type: authenticated`
and delivered through signed URLs that expire after 30 minutes, because a
public `upload` asset is readable for ever by anyone who gets the URL. Uploads
are signed per asset — the browser posts straight to Cloudinary with a
signature this server issued for one folder and one public_id, so an image
never crosses a server action's body limit and cannot land anywhere else.
`progress_photos.storage_path` holds the public_id, never a URL, since a signed
URL is a dead link by the time anyone reads it back.

Account deletion removes the assets too (`destroyUserPhotos`), at request time
rather than at purge time: the SQL job cannot reach object storage, the request
cannot be cancelled, and holding someone's body photos for the 30-day window
after they asked for deletion serves nobody. Needs
`CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET`, all server-side; without
them the section renders a "not configured" note instead of a broken upload.

## Known small ones

- `lib/data.ts:124` — `previous: null // TODO: fetch previous week in one query`,
  so week-over-week deltas on the coach dashboard are absent.
- Admin coach/client view switching no longer exists — `lib/view-mode.ts` went
  with demo mode on 2026-09-14. A live equivalent is a real access-control
  decision about health data and should not be added casually.
