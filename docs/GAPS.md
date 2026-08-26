# Gaps — spec vs. code

`PRODUCT_SPEC.md` and `DEVELOPMENT_PLAN.md` describe the intended product.
This is the honest diff against what is in the repo, so a future session doesn't
assume a feature exists because the spec (or the landing page) says it does.

Verified 2026-08-26.

## Structural

**No mobile app.** The plan's `apps/mobile` (Expo) does not exist. Every "client
app" screen is a web route in `apps/web/app/(client)/`. Three things are built
for it and unused: `supabase/functions/sync-ingest` (offline outbox),
`supabase/functions/push-dispatch` (`users.push_token` is never written by any
client), and `packages/shared/src/sync.ts`.

**Live Supabase branches are unproven.** Both builders say so in their own
header comments — `builder-actions.ts:10` and `nutrition-actions.ts:11`. The demo
branch is the one that has actually run. Expect column-name and join surprises the
first time a real database is attached.

**Tests cover only domain math.** Vitest is scoped to
`packages/**/src/**/*.test.ts`. Nothing tests a component, a server action, or a
route. The one integration-level safety net is the pgTAP RLS suite
(`supabase/tests/rls_client_isolation.test.sql`) run in CI.

## Nutrition

**1. A plan is a single day, repeated forever.** `planned_meals.day_index` exists
in the schema — `0 = every day, 1..7 = specific weekday`
([nutrition.sql:52](../supabase/migrations/20260823000400_nutrition.sql)) — but
**nothing in the app writes or reads it**. `createNutritionPlan` always inserts
the four slots at the default `0`, and `getMyPlanMeals` does not filter by
weekday. Monday and Sunday show the client identical food. Spec W6 also lists
"duplicate day" for the plan builder; only the *program* builder has it
(`duplicateProgramDay`).

*Cheapest fix:* keep `day_index = 0` meaning "default day", let the coach add
weekday overrides 1–7, and have `getMyPlanMeals` fetch `day_index in (0,
todayWeekday)` preferring the specific row. Purely additive — existing plans keep
working.

**2. No recipes or composite foods.** A meal is a flat list of raw ingredient
rows. A coach who wants "chicken bowl" in five plans re-adds chicken + rice + oil
+ broccoli five times. There is no saved recipe entity that expands into
ingredients or logs as one item. See [DISHFINDER.md](DISHFINDER.md) — the sibling
project already holds 52k ingredient-indexed recipes.

**3. No "ate as planned".** Spec C2 promises one tap to log a whole planned meal
(and the landing page advertises it in `lib/i18n/messages/landing.ts:17`). No such
action exists; the client re-logs every planned food by hand. Also missing from
the C8 quick-actions row: recents, favourites, copy-yesterday.

**4. One live plan per client.** `getMyPlanMeals` takes the single most recent
`published` plan. No date ranges, no history, no training-day vs rest-day
switching.

**5. No custom food form.** Spec C12. `foods` supports owner-scoped custom rows
and the schema is ready; there is no UI to create one, so a barcode miss
funnels to search and stops there.

## Engagement

**Streaks and badges have tables and RLS but no logic.** They are service-role
engine tables with no insert policy, and nothing anywhere writes them. Same for
`adherence_snapshots` — the formula exists in `packages/shared`, the scheduled
job that materialises weekly snapshots does not.

## Coaching

**No realtime.** No Supabase channel subscription exists anywhere in the web app.
Messages and the kitchen-style live surfaces are all server-rendered reads
refreshed by `router.refresh()`.

**`coach_feedback` is unused by the UI** — the table and policies exist; no screen
writes or reads per-set coach feedback.

## Known small ones

- `lib/data.ts:124` — `previous: null // TODO: fetch previous week in one query`,
  so week-over-week deltas on the coach dashboard are absent.
- `lib/view-mode.ts` admin coach/client switching is demo-only by design; a live
  equivalent is a real access-control decision about health data and should not
  be added casually.
