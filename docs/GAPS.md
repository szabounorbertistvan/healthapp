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

**Tests cover domain math plus an end-to-end smoke layer.** Vitest is scoped to
`packages/**/src/**/*.test.ts`. Since 2026-09-29 Playwright (`npm run e2e`)
checks that every main coach and client screen renders, the auth redirects, roster
isolation between two coaches, and one write round trip (habit tick → reload →
untick). It runs locally only — CI has no dev server or live-project access —
and still does not cover the builders or `nutrition-actions.ts`. The one integration-level safety net is the pgTAP RLS suite
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

**Badges are awarded** (2026-09-25, `award_badges_for()` and its triggers) and
shown on the social profile, but the catalog is twelve fixed thresholds — there
are no Fitness Score badges, because the score is computed in TypeScript and
the award runs in SQL. Streaks are live, but derived on the fly from completed
sessions (`lib/streak-data.ts`, `packages/shared/src/streaks.ts`), not from the
`streaks` table. `adherence_snapshots`: the formula exists in
`packages/shared`, the scheduled job that materialises weekly snapshots does
not.

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

## Coach Discovery

**Database, server actions and the coach's onboarding UI** (2026-10-01). Migration
`20261020100000_coach_discovery_foundation.sql` (suite
`supabase/tests/coach_discovery.test.sql`) is **applied to the live project**.
Built: `coach_profiles` (1:1 with `users`), reference tables (`countries`, `cities`,
`languages`, `specializations`), `coach_specializations` / `coach_languages` /
`coach_locations` / `coach_services` / `coach_certifications` /
`coach_verifications`, `coaching_requests`, `become_coach()`, the draft →
pending_review → published lifecycle with admin RPCs, `search_text` /
`search_doc`, and `coach_public_profile(slug)` — the **only** function in the
database granted to `anon` that returns profile data. Writes:
`app/coach-profile-actions.ts`; reads: `lib/coach-profile-data.ts`; shapes:
`lib/coach-profile.ts`; wizard model: `lib/coach-onboarding.ts` (unit-tested).

UI: `/settings/coach-profile` (under `(coach)`, so clients are redirected) — a
six-step wizard (`components/coach-profile/`), step in `?step=n`, saved on
Continue / Back and by a 1.5 s debounced autosave on the field steps; services and
certifications save per row. Entry points: "Become a coach" on the client's
`/account`, a status card on `/settings`. Outside `draft` the page shows the status
and a read-only preview; "Edit profile" withdraws to draft. e2e:
`e2e/coach-onboarding.spec.ts`.

Public page (2026-10-01, migration `20261021100000_coach_public_profile.sql`, applied
live, suite `coach_public_profile.test.sql`): `/coaches/[slug]` — hero, about, specializations,
services with per-service Start coaching, certifications (verified badge only when an admin
verified it), posts and public routines, follow, a sticky phone CTA, `generateMetadata`
(title / description / canonical / Open Graph / Twitter) and schema.org `ProfilePage` JSON-LD.
`components/coach-profile/preview.tsx` (`CoachProfileView`) is both the public page and
the onboarding preview. Start coaching sends `request_coaching()`; a pending request can be
cancelled from the page. **Anonymous readers get post text and counts, never post photos**
(`/api/media` requires a session); signed-in readers get the Social V2 `PostCard`. e2e:
`e2e/coach-public-profile.spec.ts` — the published-page tests need `E2E_PUBLISHED_COACH=<slug>`
and a published coach on live (none exists yet; they were run against the seeded coach
published temporarily, then restored).

Discovery (2026-10-01, migration `20261022100000_coach_search.sql`, applied live, suite
`coach_search.test.sql`): `/coaches` — search (tsvector prefix match + substring + pg_trgm
typo tolerance, unaccented), filters (country, city, online / in person, specializations — any
of, experience 1/3/5/10+, price range in RON on public prices only, accepting clients — on by
default), sorts (recommended = accepting → completeness → verified → relevance → followers →
newest; relevance; most experienced; most followed; newest), 24 per page with a crawlable
"Load more" link (`?page=n`, up to 10). All state in the URL (`lib/coach-discovery.ts`);
filtered URLs are `noindex`. `rank_score` is still never written and not used. e2e:
`e2e/coach-discovery.spec.ts` (cards need `E2E_PUBLISHED_COACH`).

Not built: sitemap / robots, city / specialization landing pages, the admin review queue UI (admins can only publish via
the `admin_*` RPCs), notifications for requests (the coach has no inbox for them yet — requests are only in
the table), certification document upload
(no private storage path yet), reviews, booking, payments.
**`accept_coaching_request` does not exist**: what happens to a client who
already has an active coach (`one_active_coach_per_client`) is an open product
decision. **Content is editable only in `draft`**: a published coach who wants
to fix a typo withdraws (page goes offline), edits, and resubmits — staged
revisions would remove that, later. The submit e2e is skipped while the seeded
coach has no profile photo (an upload cannot run in a spec).

## Paid tiers and the landing page

**The paywall is built but switched off** (2026-09-23, see ENGINES.md →
Accounts, billing, admin). Every flag in `ENTITLEMENTS` now has a gate behind
it, but `app_flags.paywall` is off, so nobody is limited and there is still no
way to pay: `/billing` redirects to `/account` until the switch is on for that
person. What turning it on still needs: Stripe set up live
(`scripts/stripe-setup.mjs`, webhook endpoint, secrets — never verified on
this project), the billing page's own strings moved into i18n (the feature
lists are; the rest of `components/billing.tsx` and `/billing` is English),
and a look at every gated screen as a free and a Starter account — the gates
were typechecked and the SQL tested live, but no screen was seen rendered
gated. Share cards keep the brand on every plan; Premium buys Edit Stats, the
square format and hiding the profile, not a card without the logo.
The landing page's pricing copy (`pricingTiers`, not rendered today) was
rewritten to match the gates; no line is "soon" any more.

**Offline: sets only, and only on an open logger.** Since 2026-10-01:
- The service worker (`app/sw.ts`, Serwist) precaches the build's assets and an
  `/offline` page, so a screen that cannot load shows that page instead of the
  browser's error. Screens are never cached (one person's data), so nothing
  *opens* offline — the set logger has to be on screen when the signal goes.
- A set logged with no connection goes to an IndexedDB outbox
  (`lib/offline/outbox.ts`), shows with a "not synced" clock, and is replayed
  through the same `logSet()` action by `lib/offline/sync.tsx` (mounted in
  `(client)/layout.tsx`) on `online`, on tab focus and every 20 s. `logSet` is
  idempotent — deterministic session and set keys, a replay of a set already
  on record answers ok — and takes the set's own `loggedAt`, so a set queued
  before midnight stays in that evening's session. Items carry their user and
  replay only for that user. Finish waits for the outbox. `e2e/offline-sets.spec.ts`
  drives both the offline case and the lost-answer replay.
- Not covered: food logs, habit ticks, edits, check-ins — they still fail
  without a connection. iOS replays only when the app is opened again (no
  background sync). `sync-ingest` / `packages/shared/src/sync.ts` stay unused:
  they are the outbox endpoint for a native app, which the web does not need,
  and `sync-ingest` predates `logged_sets.rir` (it would drop it).
- The landing page claimed "offline logging" until 2026-09-16; it still should
  not, at this scope.

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
them. **Not applied to the live project yet.** The `gym` scope exists since
20261023100000 (below); `club` is still unbuilt.

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
- **There are no set types.** `logged_sets` has no warm-up / drop / failure
  column, so exercise analytics counts every logged set as a working set: a
  warm-up single at 40 kg is in the volume total and in the session's set count.
  Adding the column is a schema change plus a logger affordance plus a decision
  about what to do with the sets already stored, and was deliberately left out
  of the 2026-09-22 analytics work rather than half-done.
- **Muscle analytics stop at the exercise page.** `exercises.primary_muscles` /
  `secondary_muscles` are shown on `/exercises/[id]`, and the analytics rows
  carry what weekly-sets-per-muscle, volume-per-muscle and muscle balance would
  need — but nothing aggregates across lifts yet. The honest blocker is that
  the schema has no per-exercise muscle *weighting*, so a set of chin-ups would
  count once for lats and once for biceps as if they were equal work.
- **Workout / PR / streak post payloads are built by server actions, not
  re-derived in SQL.** The Fitness Score (since 20260930130000) and achievement
  posts are recomputed by the database; the other data posts still trust the
  action that built them, so an owner calling PostgREST directly could post a
  workout tile about themselves that no session backs. It can only misstate
  their own activity, never read anyone else's.
- **The admin panel's training-load numbers are not the app's.** Three
  rollups in `20260920100000_admin_panel.sql` (`admin_users` load_7d, the
  `admin_overview` load bands, `admin_challenge_detail` load) average
  `ls.rpe` alone — a set logged with only an RIR has no intensity there — count
  `reps = 0` sets, let a negative weight subtract volume, and window challenges
  on `started_at::date` (UTC) rather than the member's timezone. None of them
  turns a missing intensity into 1 (`avg` skips NULLs), so they were left out
  of the 20260930140000 fix; aligning them means routing them through
  `effective_rpe()` and the same rollup the challenges use.
- **SQL challenge / leaderboard rollups count exercises over `reps > 0` sets
  only**; `loadOf()` counts every exercise on the session. A session where an
  exercise has only `reps = 0` sets scores one exercise fewer in SQL. Not a
  NULL issue, so not changed with the intensity fix.
- **Two visibility settings overlap.** `leaderboard_visibility` still governs
  leaderboards on its own; `stats_visibility` governs the profile. Someone with
  private stats and a public leaderboard entry still appears on the board.
- **Comment replies stop at one level**, by constraint rather than by omission
  (`social_comment_depth_guard`). Threading deeper needs a different renderer
  than a single indent, and a decision about what a phone shows.
- **Gyms, 2026-10-02 (`20261023100000_gyms.sql` + `20261024100000_gyms_coach_discovery.sql`,
  both applied live).** An admin-curated `gyms` table (users can suggest;
  `/admin/gyms` approves, and a pasted Google Maps link prefills name + pin),
  `users.home_gym_id` with an opt-in `gym_board`, and the `gym` leaderboard
  scope (reciprocal: only someone on the board sees it). Unified with Coach
  Discovery: a coach is "at a gym" through `coach_locations.gym_id` (picked in
  the profile editor's Where step, so the claim is reviewed with the profile),
  "Coaches at your gym" on /coach lists published profiles there, and every
  request is a `coaching_requests` row, accepted by `accept_coaching_request()`
  into the same `trainer_clients` + conversation `accept_invite()` creates.
  One active coach per client stays: `request_coaching()` refuses
  ALREADY_HAS_COACH, and accepting a request whose client found a coach
  meanwhile closes it (`status = 'closed'`). The coach's inbox is on
  /dashboard and /clients. Still missing: **a map** (no provider chosen;
  `lat`/`lng`, `google_place_id`, `osm_id` wait for it), **a notification** when
  a request arrives, a link from `gyms.city` to `cities`, and gym filters in
  coach search.
- **Nothing shares outside the app yet.** `lib/share-payload.ts` builds the
  card data for every post kind, but no button calls it and no image is
  rendered from it; §19 asked for the infrastructure, not the integration.
- **The feed cursor is `created_at` alone** (`social_feed`'s `p_before`). Two
  posts with the identical timestamp at a page boundary would lose one. The
  notifications center moved to a `created_at|id` cursor for exactly this; the
  feed has not, because posts are written one at a time.
- **Routine templates are a shelf, not a catalogue.** The library ships with no
  seeded programs: Discover shows whatever real people have published, and is
  empty on a fresh deployment. A seeded set (PPL, Upper/Lower, 5/3/1, Full
  Body) needs nothing new in the schema — a system account owning public
  programs would appear in Discover exactly like anyone else's.
- **Routine ratings do not exist.** The card has room for one and
  `discover_programs` sorts only by `created_at` and `copy_count`, both real
  counts. Ratings would need their own table and a sort key; nothing was faked
  in the meantime.
- **A coach cannot publish a template.** `programs_shareable_only_solo` allows
  a non-private visibility only when `coach_id is null`, because a coach
  program belongs to one named client. A coach publishes from their own
  training account instead. If coach-authored public templates are wanted, that
  is a nullable `client_id` plus a rewrite of every policy that assumes it —
  deliberately not attempted here.
- **`program_usage` counts sessions across every copy.** That is the honest
  answer to "is anyone training this?", but it means a routine's author sees a
  number that includes strangers' sessions. Only aggregates are exposed, never
  identities; `program_assignees` (which does name people) is restricted to the
  coach who authored the source.
- Bodyweight exercises log `weight_kg = 0`, so their volume is 0 and they
  produce no 1RM. Nothing infers a body weight from `measurements` to fill the
  gap, and analytics does not pretend otherwise — `relevantOneRm` returns null
  rather than a number built on a guess.
