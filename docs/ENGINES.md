# Engine map

What each part of HealthApp does, which files hold it, and how finished it is.
Read [../CLAUDE.md](../CLAUDE.md) first for the conventions all of these follow
(demo/live two-branch actions, `ActionResult`, cookie i18n, RLS).

Maturity legend: **solid** = works both branches, **demo-only** = the live
Supabase branch exists but has never run against a database, **stub** = partially
wired, **missing** = spec'd but not written.

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

**Maturity: demo-only.** The Supabase branch of `builder-actions.ts` is written
and RLS-guarded (`lib/supabase/mutate.ts`) but has not been driven end-to-end
against a live project; see `docs/superpowers/specs/2026-09-08-s1-*`.

---

## Nutrition

| | |
|---|---|
| Coach | `app/(coach)/nutrition`, `nutrition/new`, `nutrition/[id]` |
| Client | `app/(client)/food` |
| Writes | [app/nutrition-actions.ts](../apps/web/app/nutrition-actions.ts) (coach side), `logFood` / `updateFoodLog` / `deleteFoodLog` (client side) |
| Reads | `getNutritionPlans` / `getNutritionPlan`, `getMyDayNutrition` / `getMyPlanMeals` / `getMyFoodDays` |
| Tables | `foods`, `nutrition_plans → planned_meals → planned_meal_foods`, `food_logs` |
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

**Maturity: demo-only** on the coach side (`nutrition-actions.ts:11`); the client
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

---

## Accounts, billing, admin

| | |
|---|---|
| Routes | `app/login`, `app/reset-password`, `app/auth/callback` (route handler), `app/(coach)/settings`, `app/(coach)/admin`, `app/(client)/billing` |
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
(`role_not_self_service.test.sql`). The same migration makes the `users`
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
