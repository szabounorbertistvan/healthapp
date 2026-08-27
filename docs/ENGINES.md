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
| Client | `app/(client)/workout`, `workout/[dayId]` |
| Writes | [app/builder-actions.ts](../apps/web/app/builder-actions.ts), `logSet` / `finishWorkout` in [client-actions-app.ts](../apps/web/app/client-actions-app.ts) |
| Reads | `getPrograms` / `getProgram` (data.ts), `getMyProgramDays` / `getWorkoutDay` / `getMySessions` / `getMyPrs` (client-data.ts) |
| Tables | `programs → program_days → program_exercises`; `logged_sessions → logged_sets` |
| Components | `program-builder.tsx`, `exercise-picker.tsx`, `set-logger.tsx` |

Coach builds program → days → exercises (sets/reps/rest/tempo/notes), can
duplicate a day, then publishes. Client opens a day, logs sets, finishes the
session. PRs are computed in `packages/shared/src/prs.ts`.

**Maturity: demo-only.** `builder-actions.ts:10` says outright that the Supabase
branch has never run live.

---

## Nutrition

| | |
|---|---|
| Coach | `app/(coach)/nutrition`, `nutrition/new`, `nutrition/[id]` |
| Client | `app/(client)/food` |
| Writes | [app/nutrition-actions.ts](../apps/web/app/nutrition-actions.ts) (coach side), `logFood` / `updateFoodLog` / `deleteFoodLog` (client side) |
| Reads | `getNutritionPlans` / `getNutritionPlan`, `getMyDayNutrition` / `getMyPlanMeals` |
| Tables | `foods`, `nutrition_plans → planned_meals → planned_meal_foods`, `food_logs` |
| Components | `nutrition-builder.tsx`, `new-plan-form.tsx`, `food-logger.tsx`, `food-entry.tsx`, `barcode-scanner.tsx` |
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
`habit_logs`, `streaks`, `badges`, `user_badges`. Components `add-habit-form.tsx`,
`habit-ticks.tsx`. Streaks and badges have tables and RLS but no award logic —
those are service-role engine tables with no insert policy, and nothing writes them.

---

## Accounts, billing, admin

| | |
|---|---|
| Routes | `app/login`, `app/(coach)/settings`, `app/(coach)/admin`, `app/(client)/billing` |
| Writes | [billing-actions.ts](../apps/web/app/billing-actions.ts) — `startCheckout`, `openBillingPortal`, `adminSetTier`; `createInvite` |
| Tables | `users`, `trainer_clients`, `subscriptions` |
| Migrations | `..._subscriptions.sql`, `..._admin_role.sql`, `..._stripe_billing.sql` |
| Edge function | `stripe-webhook` |

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
