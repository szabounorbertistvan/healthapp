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

### Social v2 (added 2026-09-24)

| | |
|---|---|
| Client | `/feed` (scopes: following · all · mine), `/feed/[postId]`, `/people` (search + suggestions), `/people/[id]` (tabs + mutuals), `/notifications` |
| Reads | [lib/social-data.ts](../apps/web/lib/social-data.ts) — `getPost`, `getComments`, `getMentionCandidates`, `getSuggestedPeople`, `getMutualFollowers`; [lib/notifications-data.ts](../apps/web/lib/notifications-data.ts) gains actors |
| Writes | `addComment(postId, body, parentId)`, `mentionCandidates`, `loadComments` in [app/social-actions.ts](../apps/web/app/social-actions.ts); `markNotificationRead` in `client-actions-app.ts` |
| Maths | [packages/shared/src/mentions.ts](../packages/shared/src/mentions.ts) — `extractMentionHandles`, `commentSegments`, `mentionQueryAt`, `applyMention`, `resolveMentions` |
| Migration | `20260924100000_social_v2.sql` |
| Tables | `social_comments.parent_id`, new `social_comment_mentions`. Two new notification categories |
| Components | `comment-thread.tsx`, `notification-list.tsx` |
| Tests | `mentions.test.ts` (27), `share-payload.test.ts` (13), `supabase/tests/social_v2.test.sql` (37 pgTAP) |

**Replies are one level deep**, enforced by `social_comment_depth_guard()` —
a reply answers a top-level comment, on the same post, and cannot itself be
replied to. Arbitrary nesting is unrenderable on a 375px phone.

**Mentions are rows, not parsing.** The body keeps the literal `@maria` text;
`social_comment_mentions` holds the resolved ids. `commentSegments()` returns
an array of text and mention pieces that React renders as elements, so there is
no string containing markup for anything to interpret — a comment containing
`<img onerror=…>` renders as those characters. A handle links only when a row
says so.

**A mention grants nothing.** `notify_new_mention()` asks the post's visibility
question *as the mentioned person* before writing anything, so naming somebody
in a comment on a private post is silent and leaves no trace in their bell.

**Comment notifications**: the post's author gets `new_comment`, the parent
comment's author gets `comment_reply`, nobody gets notified of their own
typing, and one comment produces at most one notification per person — being
both replied to and mentioned is one ping, the reply.

**Read state is explicit.** Opening the bell no longer marks everything read —
it used to, which destroyed the only thing unread is for. A row is read when it
is followed (`markNotificationRead`), or by the explicit "mark all as read".

**Feed scopes widen who is listed, never what is visible.** `social_feed()`
grew `p_scope` and `p_type`; the visibility predicate is applied on top of all
three scopes in SQL. `social_post()` replaced a `getPost` that fetched fifty
posts by the same author and scanned for the one it wanted.

**Suggestions are counted, not modelled**: people followed by the people you
follow, most shared connections first. No affinity score, nothing that cannot
be explained in one sentence to the person seeing it.

**`lib/share-payload.ts` is preparation for §19** — one `SharePayload` shape
for workout / PR / streak / challenge / program, built only from a post's
stored snapshot. `progress` is excluded: it is the one payload that may carry a
body weight the author typed in.

**Maturity: unverified against live data.** Typecheck, 586 vitest cases and 22
pgTAP suites pass; the signed-in pages have not been opened against the live
project.

### Social v2 completion: privacy, badges, achievements (added 2026-09-25)

| | |
|---|---|
| Client | `/people/[id]` (relationship chip, gated stats, Fitness Score snapshot, `#achievements`, public programs, achievements tab), `/people` (live search, paged; suggestions with a most-followed fallback), `/notifications` (all · unread, cursor-paged), privacy card on `/account` and `/settings`, share card on `/fitness-score` |
| Reads | `getProfileBadges`, `getMySocialPrivacy`, `getReplies`, paged `searchPeople` in [lib/social-data.ts](../apps/web/lib/social-data.ts); `getProfileRoutines` in `lib/routine-data.ts`; `getNotificationPage` in [lib/notifications-data.ts](../apps/web/lib/notifications-data.ts) |
| Writes | `editComment`, `loadReplies`, `shareAchievement`, `shareFitnessScore`, `publishFitnessScore`, `updateSocialPrivacy` in `app/social-actions.ts`; `loadNotifications` in `client-actions-app.ts`. Caption mentions are written by `insertPost` |
| Maths | [packages/shared/src/achievements.ts](../packages/shared/src/achievements.ts) — `earnedBadges`, `longestRun`, `fitnessScorePostPayload`, `canSeeStats`, `canSeeFitnessScore`, `followState`; [lib/notification-href.ts](../apps/web/lib/notification-href.ts) — routing, sentence, cursor |
| Migration | `20260925100000_social_v2_completion.sql` |
| Tables | `users.stats_visibility` / `fitness_score_visibility` / `fitness_score_public(_at)`, `social_comments.edited_at`, new `social_post_mentions`; post types `achievement`, `fitness_score`; notification category `badge_earned`; four badges added to the catalog |
| Components | `social-v2.tsx` (BadgeShelf, ShareFitnessScore, SocialPrivacyCard, PeopleSearchBox, MentionText, mention suggester), `social-skeleton.tsx` |
| Tests | `achievements.test.ts` (22), `notification-href.test.ts` (12), `supabase/tests/social_v2_completion.test.sql` (66 pgTAP) |

**Privacy lives in the RPCs, not the page.** `social_profile()` and
`social_streak()` are security definer and used to answer anyone with anyone's
workout / PR counts and streak. `can_see_stats()` (self · setting · active
coach · admin) now gates the numbers inside `social_profile`, `social_streak`
and `social_badges`; hidden numbers come back **null**, and the page says they
are private rather than showing zeros. Follow counts stay visible — the graph
is already public through `social_follow_list`.

**The Fitness Score on a profile is a snapshot.** It is computed in TypeScript
from private sets, so nobody else can compute it. The owner publishes it
(`set_public_fitness_score`, 0..100, own row only) and chooses who sees it
(`fitness_score_visibility`, private by default).

**Badges are awarded by the database.** `award_badges_for()` (not granted to
anyone) counts real rows — completed sessions, the longest workout streak, PR
sets, check-ins, finished challenges, consecutive food-log days — and inserts
into `user_badges`, which has no insert policy. Triggers on `logged_sessions`,
`check_ins`, `challenge_participants` and `food_logs` call it, swallowing any
failure so a badge can never roll back a workout. Existing history was
backfilled silently. `earnedBadges()` mirrors the thresholds.

**Snapshots are immutable.** The update grant on `social_posts` is now
column-level (`text`, `visibility`, `deleted_at`) and on `social_comments`
`body` only. `social_posts_guard` checks that `payload.kind` matches `type`,
refuses an achievement the author has not earned and rebuilds its payload
from the catalog, and bounds a Fitness Score post (0..100, a milestone from the
fixed list at or under the score).

**Replies page.** A thread carries its first three replies and `reply_count`;
`social_comment_replies()` serves the rest on a cursor.

**Notification cursor is `created_at|id`**: one award run writes several rows
with the same `now()`, so `created_at` alone would skip one at a page boundary.

**The Fitness Score is the database's number when it leaves the owner's
screen** (`20260926100000_social_v2_cleanup.sql`). `fitness_score_of()` is
`fitnessScore()` composed over `training_load_score()` — the same formula,
pinned by `apps/web/lib/fitness-score-parity.test.ts` and
`supabase/tests/social_v2_cleanup.test.sql`, which score one fixture to the
same numbers. `set_public_fitness_score()` takes no argument, and
`social_posts_guard` replaces a `fitness_score` payload with the author's real
score, milestone and band, so a PostgREST call sending `100` publishes the real
number or nothing.

**Posts can be re-captioned** from the `…` menu on your own post (`editPost`):
only `text` changes (column grant), the database stamps `edited_at`, the card
says "edited", and caption mentions are re-resolved. Delete stays on the post's
own page. `validatePostEdit()` holds the rule: a text post keeps 1–500
characters, a data post may drop its caption.

### Routine library (added 2026-09-23)

| | |
|---|---|
| Client | `app/(client)/routines` (tabs: mine · discover · saved), `routines/[id]` (structure, actions, usage) |
| Coach | `(coach)/programs/[id]` keeps the structure editor and links to `/routines/[id]` for duplicate / assign / details |
| Reads | [lib/routine-data.ts](../apps/web/lib/routine-data.ts) — `getMyRoutines`, `getSavedRoutines`, `getDiscoverRoutines`, `getRoutineDetail`, `getRoutineUsage`, `getRoutineAssignees` |
| Writes | [app/routine-actions.ts](../apps/web/app/routine-actions.ts) — `copyRoutine`, `toggleRoutineSave`, `updateRoutineDetails`, `shareRoutine` |
| Maths | [packages/shared/src/routines.ts](../packages/shared/src/routines.ts) — `estimateMinutes`, `copyName`, `canSeeProgram`, `canCopyProgram`, `canChangeVisibility`, `snapshotProgram` |
| Migration | `20260923130000_program_library.sql` (was 20260923100000, which collided with `exercise_video_links` on main and on production) |
| Tables | `programs` + 6 columns, new `program_saves`. **No new program table** — a routine IS a program |
| Components | `routine-card.tsx`, `routine-filters.tsx`, `routine-actions-ui.tsx` |
| Tests | `routines.test.ts` (34), `supabase/tests/program_library.test.sql` (31 pgTAP) |

**Assigning is copying.** `programs.client_id` is NOT NULL and has always bound a
program to exactly one person, so there is no shared row to assign. One RPC —
`copy_program(source, name, for_client)` — is therefore behind all three
buttons: Duplicate, "Copy to my programs" and "Assign to a client". Copies are
independent all the way down (new program, days and prescribed exercises);
`source_program_id` records lineage only, and is `on delete set null` so
deleting an original never touches its children.

**A coach program can never be published.** The check constraint
`programs_shareable_only_solo` allows `visibility <> 'private'` only when
`coach_id is null`. A coach's program is written for one named client, so
publishing it would publish somebody's prescription. A coach who wants a public
template builds it from their own training account (`/routines`), where
`coach_id` is null — the same surface as **My training**.

**Reads are RPCs, not loops.** A card carries day and exercise counts, the
muscle groups across every exercise, the author and whether the reader saved it
— four round trips per card done naively. `program_card_rows()` does it in one,
and `my_programs()` / `discover_programs()` wrap it. Discover pages by offset
(two sort keys rule out one keyset shape) and fetches one row past the page to
answer "is there a next one" without a count query.

**Saving is a bookmark, not a copy.** `program_saves` has a unique
`(user_id, program_id)` and an owner-only policy whose *with-check* calls
`can_see_program` — which is what stops a private routine being bookmarked by
id. The toggle is optimistic because the constraint settles any race: a losing
second tap reports already-saved rather than an error. Same shape as follows
and kudos.

**Sharing is a snapshot.** `social_posts` gained the `program` type and a
partial unique index on `(user_id, payload->>'program_id')`. The payload comes
from `snapshotProgram()` and carries the plan — days, exercises, muscle groups,
estimate — and nothing anyone has logged. Editing the routine later never
rewrites the post, which is how every other post type in this app behaves.

**The editor was already there.** Reorder (days by `day_index` via
`move_program_day()`, exercises by `position`), duplicate day, rename day,
add/remove exercise and a targets form pre-filled from `DEFAULT_TARGETS` all
predate this work. The one thing missing was renaming the *program*, which
`updateRoutineDetails` now does alongside description, level, goal and
visibility.

**Maturity: unverified against live data.** Typecheck, 546 vitest cases and 20
pgTAP suites pass; the signed-in pages have not been opened against the live
project.

### Exercise analytics & previous workout (added 2026-09-22)

| | |
|---|---|
| Client | `app/(client)/exercises/[id]` (one lift: header, bests, three charts, session history); the "Previous" block inside `workout/[dayId]/log` |
| Reads | `getPreviousForDay` / `getExerciseHistory` / `getExerciseProfile` in [lib/exercise-analytics-data.ts](../apps/web/lib/exercise-analytics-data.ts); row mapping in `lib/exercise-analytics-map.ts` |
| Maths | [packages/shared/src/exercise-analytics.ts](../packages/shared/src/exercise-analytics.ts) — `previousWorkouts`, `prefillFor`, `exerciseSessions`, `exerciseStats`, `metricSeries`, `progressionVs`, `relevantOneRm`, `exerciseSnapshot` |
| Tables | `logged_sets` joined to `logged_sessions` — **no new table, no new column, no RPC, no migration** |
| Components | `exercise-analytics.tsx` (page), `previous-sets.tsx` (`PreviousSets` + `ProgressionNote`) |
| Tests | `exercise-analytics.test.ts` (50), `exercise-analytics-map.test.ts` (6), `supabase/tests/exercise_history.test.sql` (6 pgTAP) |

The logger shows every set of the last **completed** session on each lift,
right above the boxes, and pre-fills each box from the *same set number* of
that session (`prefillFor`) — so a descending block offers 105 for set 2 rather
than 110 again. After a set lands, one factual line compares it with that same
set number: `↑ +2.5 kg vs previous`, never a verdict. `/exercises/[id]` is the
long view: last performance, best weight / reps / volume / estimated 1RM,
session and set counts, lifetime volume, three progressions (top weight, volume,
estimated 1RM) over 7 / 30 / 90 / 365 days / all time, and every completed
session set by set.

Two rules the module exists to enforce: an **abandoned session is never
"previous"** (the read inner-joins `logged_sessions` on `completed_at not null`,
and `toAnalyticsSets` repeats the check because an embedded PostgREST filter is
one parameter away from silently not applying), and **weights are never rounded
in transit** — 21.25 kg stays 21.25 kg, and the display does the rounding.

1RM is the existing Epley in `prs.ts`. That file gained `estimated1RMExact`
(unrounded, for sorting and charting); `estimated1RM` still rounds to one
decimal and is still what PR detection compares, unchanged. Analytics uses
`relevantOneRm`, which returns **null above 12 reps** where Epley stops
describing a one-rep max — PR detection keeps its own unbounded rule, because
narrowing it would silently rewrite `is_pr` on rows already stored.

Reads are one query each, index-covered by `logged_sets_history_idx
(user_id, exercise_id, received_at desc)`, which had no reader until now.
Privacy is policy `sets_owner`, not app code: the queries filter by exercise,
never by user, so `supabase/tests/exercise_history.test.sql` is what proves one
person cannot read another's history by typing an id into the address bar.

**Maturity: unverified against live data.** Typecheck, 512 vitest cases and 18
pgTAP suites pass; the signed-in pages have not been opened against the live
project (no session on this box).

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
