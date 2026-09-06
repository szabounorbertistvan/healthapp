# Solo client — training (slice 1)

**Status:** design approved, not implemented
**Date:** 2026-09-06

## Problem

The app assumes every client has a coach. A person with no trainer — and no
wish for one — can sign up, but lands on `/today` with no program, no plan and
no explanation of what to do next. Nothing in the client surface can create a
program; it only reads one a coach published.

The goal: someone training alone gets the same product, minus the coach. They
choose their own training days, pick the muscle groups each day covers, fill
those days from the exercise library, and follow the result with the logger
that already exists.

## What already exists

This matters, because it makes the work smaller than it first appears.

- **The database already models solo.** `programs.coach_id` and
  `nutrition_plans.coach_id` are nullable, commented "Solo-client routines:
  coach_id null, client_id = owner".
- **RLS already permits it.** `programs_solo_all` and `nplans_solo_all` in
  `20260823000800_rls.sql` grant a client full CRUD over their own coachless
  rows:

  ```sql
  create policy programs_solo_all on public.programs for all to authenticated
    using (coach_id is null and client_id = auth.uid())
    with check (coach_id is null and client_id = auth.uid());
  ```

- **Set logging is done.** `SetLogger` records weight × sets × reps with an
  RPE/RIR field driven by the program's `intensity_mode`. It reads
  `day.intensity_mode` and does not care who authored the program.
- **The exercise library is loaded** — 876 rows, with `primary_muscles` and
  `secondary_muscles`, searchable through `searchExerciseLibrary`.
- **The adherence engine handles coachless clients** —
  `SOLO_SESSIONS_PER_WEEK = 3` is the denominator when a week has no planned
  days.

So this slice adds no permissions work and no logging work. It adds a *source*
for the program, and the entry point that leads a new user to it.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Where does a solo program come from? | The client builds it, from the existing exercise library | Full control was the explicit ask; templates were rejected |
| Is "solo" stored state? | No — derived from having no active `trainer_clients` row | Avoids the classic double-state bug: a user flagged solo who nonetheless has a coach |
| Coach program vs self-built program | The coach's wins while a coach is active; the solo one stays saved and returns if the relationship ends | Simple to explain: "while you have a coach, the coach decides" |
| Muscle groups per day | Stored, `program_days.muscle_groups text[]` | Lets the app know what is being trained — needed later for "you have not trained back in 12 days" |
| Gating | 30-day trial, with some features cut afterwards; which ones is deferred | Superseded an earlier "free, unlimited" answer |

## Scope

**In this slice:** onboarding choice, the coach/solo priority rule, the
`muscle_groups` column, and the training builder on the client surface.

**Deferred to slice 2 (solo nutrition):** the nutrition plan builder, and
entering macros directly without picking a food. The priority rule *is* applied
to `nutrition_plans` reads here, because it is three lines and leaving the
ambiguity behind would be worse than closing it early.

**Deferred to slice 3 (trial gating):** which features the 30-day trial cuts.
No entitlement checks are added in this slice.

## Design

### Onboarding

A new `/welcome` route, inside the `(client)` route group so it inherits the
signed-in shell, with two paths:

- **I have a trainer** — an invite-code field calling the existing
  `accept_invite(code)` RPC. Its `INVALID_CODE` / `EXPIRED` /
  `ALREADY_HAS_COACH` errors are already mapped to message keys in
  `packages/api/src/errors.ts`. On success, `/today`.
- **I train alone** — straight to `/today`, whose empty state offers "build
  your first program".

**When it shows.** Because solo is derived, a new user *is* solo, so there is
no flag saying "this person has been onboarded". `/welcome` therefore appears
when the account is **empty**: no active coach, no programs, no nutrition
plans. All three are already queryable. The moment the user accepts an invite
or creates a program, the account is no longer empty and the screen stops
appearing.

The redirect lives in `(client)/layout.tsx`, next to the existing one that
sends coaches to `/dashboard`. It costs one extra query, and only when the user
has no coach.

The choice is not a gate. Someone without their code to hand picks solo now and
accepts the invite later from settings.

### Priority rule

`getMyProgramDays` currently takes the most recently updated published program
for the client. With both a solo program and a coach program published, the
winner is whichever was touched last — arbitrary and surprising.

New rule: **if an active coach exists, read the program with a non-null
`coach_id`; otherwise the one with `coach_id is null`.**

The choice itself is extracted as a pure function in `packages/shared` so it is
covered by vitest — it is the only new branching logic in the slice. The same
rule is applied to `getMyDayNutrition` and `getMyPlanMeals`.

### Schema

One migration, one column:

```sql
alter table public.program_days
  add column muscle_groups text[] not null default '{}';
```

No check constraint on the values. The library can grow, and the picker only
ever offers groups that exist in it, so a constraint would age badly while
adding nothing. Today the library yields 17 groups: quadriceps, shoulders,
abdominals, chest, hamstrings, triceps, biceps, lats, middle back, calves,
lower back, forearms, glutes, traps, adductors, neck, abductors.

Because the picker sources its options from `exercises.primary_muscles`, the
values stored on a day always match the values used to filter exercises.

### The builder

A new route, `(client)/workout/build`, reached from the `/workout` empty state
and from `/welcome`. Days are stacked cards, not the columns the coach builder
uses — the client surface is thumb-first, and its sidebar is
`hidden sm:flex`.

- **Add day** — a name, plus a multi-select of muscle groups
- **Add exercise** inside a day — `ExercisePicker`, pre-filtered to that day's
  muscle groups
- **Per exercise** — sets, reps, weight, rest, and an RPE/RIR target: exactly
  the columns `program_exercises` already holds
- **Publish** — sets `status = 'published'`, after which `/workout` picks it up
  through the normal read path

### Server actions

`builder-actions.ts` gains a solo path writing `coach_id: null, client_id:
auth.uid()`. The business logic stays in one place; only the presentation is
new.

A client cannot smuggle another user's id into `coach_id` or `client_id`:
`programs_solo_all` rejects any row that is not `coach_id is null and client_id
= auth.uid()`. The action's own checks are the readable layer; the policy is
the enforcing one.

## Testing

- **Unit** — the program-selection function in `packages/shared`, covering:
  active coach with both programs present, active coach with only a solo
  program, no coach with both present, no coach with neither.
- **Browser** — demo mode for the builder flow end to end; live mode for the
  priority rule, which needs a real coach relationship.
- **CI** — the `database` job applies the new migration on a clean stack.

## Open questions

- Which features the trial cuts on day 31 (slice 3).
- Whether a solo client should be able to keep more than one program and switch
  between them. Out of scope here: it needs an `is_active` flag, which is the
  stored state this design deliberately avoids.
