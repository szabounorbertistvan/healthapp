# S1 — Coach writes, verified against a live database

**Status:** approved 2026-09-09 with one change (see *Decision*); write guard and `day_index` landed the same day
**Date:** 2026-09-08
**Subsystem:** 1 of 5 (see the decomposition at the end)

## Why this is first

`builder-actions.ts` and `nutrition-actions.ts` carry the same admission in
their headers:

> The Supabase branch has never run against a live database — there is no Docker
> on the dev machine yet — so treat it as written-to-schema, not verified.

Those two files are the coach's job. `builder-actions.ts` is spec W4 (program
builder), `nutrition-actions.ts` is W6 (nutrition plan builder). Production now
has a real Supabase project and working authentication, so the first coach to
sign in will be the first execution of that code against a database.

This subsystem is not a feature. It is the claim "the coach surfaces work" moving
from unverified to verified, and fixing whatever that reveals.

## What the audit already found

These are not hypotheses. They come from reading the actions against
`20260823000300_training.sql` and `20260823000800_rls.sql`.

### 1. RLS-filtered writes report success

`publishProgram`, `updateProgramExercise` and `removeProgramExercise` all follow
this shape:

```ts
const { error } = await supabase.from("programs")
  .update({ status: "published" }).eq("id", programId);
if (error) return { ok: false, message: error.message };
return { ok: true };
```

When an RLS policy excludes the row, PostgREST does not raise an error. It
matches zero rows and returns success. `error` is null, the action returns
`{ ok: true }`, the UI calls `router.refresh()`, and the coach sees the old
state with no explanation.

The demo branch cannot exhibit this: it mutates an in-memory store directly, so
every write "succeeds". **This is the single most important structural defect,
and it is invisible in every environment we have run so far.**

Affected: every `update` and `delete` in both action files.

### 2. A program cannot be built for a client who has not accepted yet

`programs_coach_all` carries `with check (coach_id = auth.uid() and
public.is_active_coach_of(client_id))`. `createProgram` inserts with the coach's
id and a `client_id` from the UI. If that relationship is still `invited` rather
than `active`, the insert is rejected.

The demo store has no such rule, so the flow looks fine today. Whether this is a
bug or correct behaviour is a product question — but the current UI gives the
coach no way to understand the refusal.

### 3. `day_index` is computed as a program-wide count against a per-week unique key

`program_days` is unique on `(program_id, week_index, day_index)`.
`addProgramDay` computes `day_index` as the count of **all** days in the program
and always writes `week_index: 1`. Two consequences:

- A program with `weeks > 1` can never receive a day in week 2 through the UI.
- `duplicateProgramDay` writes `week_index: source.week_index` with a
  program-wide `day_index`, so once more than one week exists the ordinal is
  meaningless and collisions become reachable.

The schema comment itself is ambivalent — `-- 0=Sun .. 6=Sat, or ordinal within
week`. The code picked ordinal; the constraint assumes per-week. That
disagreement has to be settled before either can be trusted.

### 4. The nutrition builder has not been read at this depth yet

`nutrition-actions.ts` (377 lines) follows the same two-branch shape and the same
header disclaimer. It is in scope; the equivalent audit is part of the work, not
a precondition for it.

## Scope

**In:**

- An executable path for running the live branch, and the test harness to drive it
- Auditing and fixing `builder-actions.ts` and `nutrition-actions.ts` against a
  real database
- A general guard so an RLS-filtered write can never report success
- Settling the `day_index` semantics
- Replacing the "never run live" headers with what is actually true

**Out:**

- New features of any kind. If the audit reveals a missing capability rather than
  a defect, it becomes a work item for another subsystem, not scope creep here.
- The client-side action files (`client-actions-app.ts`), which have run live
- Anything in subsystems S2–S5

## Approach

### Running the live branch

There is still no Docker on this machine, so `supabase start` is unavailable.
Three options:

1. **A second Supabase project used only for integration tests.** Migrations
   applied with `supabase db push`, seeded with the existing
   `npm run seed:accounts` and `seed/foods.sql`. Isolated from production, safe
   to reset, costs one free-tier project.
2. **The production project, with test accounts.** No new setup — the seed script
   already targets whatever `.env.local` points at. But integration tests would
   write to the database real users depend on.
3. **Install Docker and use the local stack.** Best long-term, largest detour now.

**Recommended: option 1.** It is the only one that lets a test suite create and
destroy data freely, which is what makes the tests worth writing. Option 3 stays
open later; nothing in this design depends on which of the two is used, because
both are reached through the same environment variables.

**Decision (2026-09-09): option 2 for now.** The production project has no real
clients yet, so it *is* the staging environment, and the seeded test accounts
(admin / trainer / client) already live there. A second project is deferred
until the first real client signs up; at that point the integration tests move
to it unchanged, since they only read connection details from the environment.
The pgTAP job in CI remains the one place a migration is applied to a clean
database before it reaches the dashboard.

### The write guard

*Landed 2026-09-09:* `apps/web/lib/supabase/mutate.ts`, applied to all six
update/delete sites across the two files, with a unit test on the pure core and
a translated `common.actions.nothingChanged` message. `day_index` was settled the
same day as *ordinal within week* (code, demo store and a `comment on column`
migration agree); the coach's program view now sorts days explicitly.

Supabase's `update` and `delete` accept `{ count: "exact" }`. A small helper
turns "matched nothing" into a failure:

```ts
// lib/supabase/mutate.ts
// PostgREST answers an RLS-filtered write with success and zero rows. Every
// update and delete goes through here so that silence becomes an error the
// caller can return to the user.
export function mutated({ error, count }: { error: PostgrestError | null; count: number | null }):
  ActionResult | null
```

Returning `null` means "fine, carry on"; returning an `ActionResult` means the
caller returns it. Every `update` and `delete` in the two action files is routed
through it.

This is deliberately not a clever abstraction. It is one function with one job,
applied uniformly, so a future action that forgets it stands out in review.

### Test harness

The repo has no test for a server action today — Vitest is scoped to
`packages/**/src/**/*.test.ts`. This subsystem adds the first, because verifying
the live branch requires driving it repeatably.

- Widen the Vitest config to a second project covering `apps/web/**/*.test.ts`
- Integration tests sign in as the seeded coach, exercise the builder flow
  end-to-end against the test project, and assert on database state
- They are skipped, not failed, when the test project's environment variables are
  absent, so `npm test` stays green for someone without credentials and CI can
  opt in

## Error handling

The `ActionResult` contract is unchanged: `{ ok, message?, demo? }`. What changes
is that `ok: false` becomes reachable on paths where it currently cannot be.

Messages must be translated, not raw Postgres text. Two new cases join
`lib/i18n/messages/`: a write that matched nothing, and a program created for a
client whose relationship is not active. The existing `lib/auth-errors.ts` is the
pattern to follow — map the backend's English to a locale key.

## Testing

| Layer | What it covers |
|---|---|
| pgTAP (exists) | RLS isolation; extended with cases for the write paths audited here |
| Integration (new) | Each exported action in both files, run live, asserting database state |
| Unit (exists) | Untouched — domain math in `packages/shared` |

Acceptance:

1. Every exported function in both action files has run against a live database,
   and its result is recorded in this repo.
2. No `update` or `delete` in either file can return `ok: true` without having
   changed a row.
3. `day_index` has one documented meaning that the code and the unique
   constraint agree on.
4. A coach can build, duplicate, publish and edit a program, and build and
   publish a nutrition plan, against the test project.
5. The file headers describe reality.

## Risks

- **The audit may find more than defects.** If a whole flow turns out to be
  unimplementable as written, that is a design question, and it stops this
  subsystem rather than being absorbed into it.
- **`is_active_coach_of` may be correct and the UI wrong.** Deciding that is a
  product call, flagged here rather than settled unilaterally.
- **A second Supabase project is a real dependency.** If it is not wanted, the
  fallback is option 2 with a namespaced test account, and the tests become
  read-mostly — weaker, and the design should be revisited rather than quietly
  degraded.

## Where this sits

Five independent subsystems remain against the product spec
(`PRODUCT_SPEC.md` at the repo root), in the agreed order:

1. **S1 — live coach writes** (this document)
2. S2 — account and privacy: export, deletion, and the missing `(client)/settings`
3. S3 — nutrition depth: ate-as-planned, custom food, per-weekday plans
4. S4 — engagement engine: streak and badge award logic
5. S5 — realtime and per-set coach feedback

Mobile, offline sync and native push are deferred; `sync-ingest` and
`push-dispatch` stay as made investments.
