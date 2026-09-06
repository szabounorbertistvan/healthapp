# Solo Client Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a client with no coach build their own training program from the exercise library and follow it with the logger that already exists.

**Architecture:** The database and RLS already model coachless programs (`programs.coach_id` nullable, policy `programs_solo_all`), and `SetLogger` already works against any program. So this adds a *source* for the program, not permissions or logging: a pure selection rule in `@healthapp/shared`, one column on `program_days`, a solo path through the existing server actions, and a thumb-first builder plus an onboarding screen on the client surface.

**Tech Stack:** Next.js 15 App Router (server components + server actions), TypeScript, Supabase (Postgres + RLS), vitest, Tailwind, in-repo i18n (`apps/web/lib/i18n`).

**Spec:** `docs/superpowers/specs/2026-09-06-solo-client-training-design.md`

## Global Constraints

- Locales are `en` and `ro` (`apps/web/lib/i18n/config.ts`); **every** user-facing string added must exist in both. Default locale is `en`.
- The client surface is thumb-first. Its sidebar is `hidden sm:flex`, so no control may live only in a sidebar.
- `@healthapp/shared` ships TypeScript source, not a build. `apps/web/next.config.ts` lists it in `transpilePackages`.
- vitest only collects `packages/**/src/**/*.test.ts` (`vitest.config.ts`). Tests placed under `apps/web` do not run.
- Server-action files (`"use server"`) may only export `async` functions.
- Never edit an applied migration; add a new one.
- Muscle-group strings must match `exercises.primary_muscles` exactly (lowercase, spaces not underscores — e.g. `middle back`).

---

### Task 1: Program selection rule

**Files:**
- Create: `packages/shared/src/programs.ts`
- Create: `packages/shared/src/programs.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type SelectableProgram = { id: string; coach_id: string | null; updated_at: string }` and `pickProgram<T extends SelectableProgram>(programs: readonly T[], hasActiveCoach: boolean): T | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/programs.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { pickProgram } from "./programs";

const coachProgram = { id: "coach", coach_id: "c1", updated_at: "2026-01-01T00:00:00Z" };
const soloProgram = { id: "solo", coach_id: null, updated_at: "2026-06-01T00:00:00Z" };

describe("pickProgram", () => {
  test("prefers the coach's program while a coach is active", () => {
    expect(pickProgram([soloProgram, coachProgram], true)?.id).toBe("coach");
  });

  test("falls back to the client's own when the coach published nothing", () => {
    expect(pickProgram([soloProgram], true)?.id).toBe("solo");
  });

  test("ignores the coach's program once the relationship has ended", () => {
    expect(pickProgram([soloProgram, coachProgram], false)?.id).toBe("solo");
  });

  test("returns null when the client has nothing at all", () => {
    expect(pickProgram([], false)).toBeNull();
  });

  test("breaks ties on updated_at, newest first", () => {
    const older = { id: "older", coach_id: null, updated_at: "2026-01-01T00:00:00Z" };
    const newer = { id: "newer", coach_id: null, updated_at: "2026-02-01T00:00:00Z" };
    expect(pickProgram([older, newer], false)?.id).toBe("newer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/shared/src/programs.test.ts`
Expected: FAIL — `Failed to resolve import "./programs"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/programs.ts`:

```ts
// Which program a client actually follows.
//
// A client can hold two published programs at once: one their coach wrote and
// one they built themselves before (or after) having a coach. Reading "the most
// recently updated" makes the winner arbitrary, so the rule is explicit: while a
// coach is active the coach decides, and the client's own program waits, intact,
// for the relationship to end.

export type SelectableProgram = {
  id: string;
  /** null = the client built this themselves. */
  coach_id: string | null;
  updated_at: string;
};

export function pickProgram<T extends SelectableProgram>(
  programs: readonly T[],
  hasActiveCoach: boolean,
): T | null {
  const newestFirst = [...programs].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  if (hasActiveCoach) {
    const fromCoach = newestFirst.find((p) => p.coach_id !== null);
    if (fromCoach) return fromCoach;
  }
  return newestFirst.find((p) => p.coach_id === null) ?? null;
}
```

- [ ] **Step 4: Add the export**

In `packages/shared/src/index.ts`, add after the `./prs` line:

```ts
export * from "./programs";
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all test files pass (5 new tests), 4 typecheck tasks succeed.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/programs.ts packages/shared/src/programs.test.ts packages/shared/src/index.ts
git commit -m "Add the rule for which program a client follows"
```

---

### Task 2: Muscle groups on a training day

**Files:**
- Create: `supabase/migrations/20260907090000_program_day_muscle_groups.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: column `public.program_days.muscle_groups text[] not null default '{}'`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260907090000_program_day_muscle_groups.sql`:

```sql
-- HealthApp schema · 16 muscle groups per training day
--
-- A client building their own week picks what a day covers before picking the
-- exercises for it, so the day has to remember the choice: it labels the card
-- and pre-filters the exercise picker.
--
-- No check constraint on the values. They mirror exercises.primary_muscles, the
-- library grows by import, and the picker only ever offers groups that exist in
-- it — so a constraint would age badly while adding nothing today.
alter table public.program_days
  add column muscle_groups text[] not null default '{}';

comment on column public.program_days.muscle_groups is
  'Muscle groups this day trains. Values mirror exercises.primary_muscles.';
```

- [ ] **Step 2: Verify it applies**

Run: `npx supabase db push --dry-run`
Expected: output lists `20260907090000_program_day_muscle_groups.sql` under "Would push these migrations".

- [ ] **Step 3: Apply it**

Run: `npx supabase db push`
Expected: `Applying migration 20260907090000_program_day_muscle_groups.sql...` then `Finished supabase db push.`

- [ ] **Step 4: Confirm the column exists**

Run:

```bash
npx supabase migration list
```

Expected: `20260907090000` appears with a non-empty `remote` value.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260907090000_program_day_muscle_groups.sql
git commit -m "Store which muscle groups a training day covers"
```

---

### Task 3: Apply the selection rule when reading

**Files:**
- Modify: `apps/web/lib/client-data.ts` (`getMyProgramDays`, `getMyDayNutrition`, `getMyPlanMeals`)

**Interfaces:**
- Consumes: `pickProgram` from Task 1.
- Produces: `async function activeCoachId(supabase, userId): Promise<string | null>` (module-private in `client-data.ts`).

- [ ] **Step 1: Add the active-coach helper**

In `apps/web/lib/client-data.ts`, add near `sessionsForDays`:

```ts
/** The coach currently working with this client, or null when they train alone. */
async function activeCoachId(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("trainer_clients")
    .select("coach_id")
    .eq("client_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return (data?.coach_id as string | undefined) ?? null;
}
```

- [ ] **Step 2: Use it in getMyProgramDays**

Replace the live-branch query in `getMyProgramDays` — the one currently ending
`.order("updated_at", { ascending: false }).limit(1).maybeSingle()` — with a
fetch of every published program followed by the rule:

```ts
  const { data: rows, error } = await supabase
    .from("programs")
    .select(`id, name, intensity_mode, coach_id, updated_at,
      program_days(id, name, week_index, day_index, muscle_groups,
        program_exercises(id, exercise_id, position, target_sets, target_reps, target_weight_kg, target_rpe, rest_seconds,
          exercise:exercises(name_en, name_ro)))`)
    .eq("client_id", auth.user.id)
    .eq("status", "published");
  if (error || !rows) return [];

  const coachId = await activeCoachId(supabase, auth.user.id);
  const data = pickProgram(
    rows as unknown as (SelectableProgram & Record<string, unknown>)[],
    coachId !== null,
  );
  if (!data) return [];
```

Add the import at the top of the file:

```ts
import { pickProgram, type SelectableProgram } from "@healthapp/shared";
```

- [ ] **Step 3: Apply the same rule to nutrition**

In `getMyDayNutrition`, replace the `nutrition_plans` query's
`.order("updated_at", { ascending: false }).limit(1).maybeSingle()` with
`.select("name, kcal_target, protein_target_g, carbs_target_g, fat_target_g, coach_id, updated_at")`
returning all published rows, then:

```ts
  const plan = pickProgram(
    (plans ?? []) as unknown as (SelectableProgram & Record<string, unknown>)[],
    (await activeCoachId(supabase, auth.user.id)) !== null,
  ) as { name: string; kcal_target: number; protein_target_g: number;
         carbs_target_g: number; fat_target_g: number } | null;
```

Do the same in `getMyPlanMeals`, whose query selects `id, planned_meals(...)` —
add `coach_id, updated_at` to its select and pick with the same call.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/client-data.ts
git commit -m "Read the coach's program while a coach is active, the client's otherwise"
```

---

### Task 4: Solo builder server actions

**Files:**
- Modify: `apps/web/app/builder-actions.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `createSoloProgram(input: { name: string; intensityMode: "rpe" | "rir" | "simple" }): Promise<ActionResult & { id?: string }>`
  - `addSoloProgramDay(programId: string, name: string, muscleGroups: string[]): Promise<ActionResult>`
  - `getMySoloProgramId(): Promise<string | null>`

`addProgramExercise`, `updateProgramExercise`, `removeProgramExercise` and `publishProgram` are reused unchanged — RLS decides whether the caller may touch the row, so they need no solo variant.

- [ ] **Step 1: Add the three actions**

Append to `apps/web/app/builder-actions.ts`:

```ts
/**
 * A program the client owns outright: coach_id null, client_id themselves.
 *
 * The values are not merely a convention — policy programs_solo_all rejects any
 * other combination, so a client cannot write a program for someone else even
 * if this action were called with different arguments.
 */
export async function createSoloProgram(input: {
  name: string;
  intensityMode: "rpe" | "rir" | "simple";
}): Promise<ActionResult & { id?: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the program a name" };

  if (isDemo) {
    const program: StoredProgram = {
      id: newId("p"),
      client_id: "d1",
      client_name: "You",
      name,
      status: "draft",
      intensity_mode: input.intensityMode,
      weeks: 1,
      updated_at: new Date().toISOString(),
      days: [],
    };
    store().programs.unshift(program);
    revalidatePath("/workout");
    return { ok: true, demo: true, id: program.id };
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  const { data, error } = await supabase
    .from("programs")
    .insert({
      coach_id: null,
      client_id: auth.user.id,
      name,
      weeks: 1,
      intensity_mode: input.intensityMode,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  revalidatePath("/workout");
  return { ok: true, id: data.id };
}

/** Like addProgramDay, but carries the muscle groups the client chose. */
export async function addSoloProgramDay(
  programId: string,
  name: string,
  muscleGroups: string[],
): Promise<ActionResult> {
  const dayName = name.trim() || "New day";

  if (isDemo) {
    const program = store().programs.find((p) => p.id === programId);
    if (!program) return { ok: false, message: "Program not found" };
    program.days.push({
      id: newId("pd"),
      week_index: 1,
      day_index: program.days.length,
      name: dayName,
      exercises: [],
    });
    revalidatePath("/workout/build");
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("program_days")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId);
  const { error } = await supabase.from("program_days").insert({
    program_id: programId,
    week_index: 1,
    day_index: count ?? 0,
    name: dayName,
    muscle_groups: muscleGroups,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/workout/build");
  return { ok: true };
}

/** The client's own draft-or-published program, if they have started one. */
export async function getMySoloProgramId(): Promise<string | null> {
  if (isDemo) return store().programs[0]?.id ?? null;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("programs")
    .select("id")
    .eq("client_id", auth.user.id)
    .is("coach_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: 4 tasks successful.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/builder-actions.ts
git commit -m "Let a client create and fill a program of their own"
```

---

### Task 5: Muscle groups end to end

**Files:**
- Create: `apps/web/components/muscle-group-picker.tsx`
- Modify: `apps/web/components/exercise-picker.tsx` (new optional prop)
- Modify: `apps/web/lib/types.ts:119` (`ProgramDetail.days`)
- Modify: `apps/web/lib/data.ts` (`getProgram`, `toProgramDetail`)
- Modify: `apps/web/lib/i18n/messages/client-app.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `<MuscleGroupPicker selected={string[]} onChange={(groups: string[]) => void} />`; `MUSCLE_GROUPS: readonly string[]`; `ExercisePicker` gains `initialMuscle?: string`; `ProgramDetail.days[].muscle_groups: string[]`.

- [ ] **Step 1: Create the component**

```tsx
"use client";

// The 17 groups the imported library actually uses, most-populated first, so a
// day's stored muscle_groups always match exercises.primary_muscles and the
// picker's filter finds something for every choice.
export const MUSCLE_GROUPS = [
  "chest", "lats", "middle back", "lower back", "shoulders", "traps",
  "biceps", "triceps", "forearms", "abdominals", "quadriceps", "hamstrings",
  "glutes", "calves", "adductors", "abductors", "neck",
] as const;

export function MuscleGroupPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (groups: string[]) => void;
}) {
  const toggle = (group: string) =>
    onChange(
      selected.includes(group) ? selected.filter((g) => g !== group) : [...selected, group],
    );

  return (
    <div className="flex flex-wrap gap-1.5">
      {MUSCLE_GROUPS.map((group) => {
        const on = selected.includes(group);
        return (
          <button
            key={group}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(group)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold capitalize ${
              on ? "bg-accent text-white" : "bg-bg text-ink-soft hover:text-ink"
            }`}
          >
            {group}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Add the i18n keys**

In `apps/web/lib/i18n/messages/client-app.ts`, add a `builder` section to **both** the `en` and the `ro` object, alongside `today` and `workout`:

```ts
  // en
  builder: {
    title: "Build your program",
    namePlaceholder: "Program name",
    intensity: "Effort scale",
    create: "Create program",
    addDay: "Add a day",
    dayNamePlaceholder: "Day name, e.g. Chest and triceps",
    muscleGroups: "Muscle groups",
    addExercise: "Add exercise",
    noDays: "No days yet. Add your first one.",
    publish: "Publish",
    published: "Published",
    publishHint: "Publishing makes it the program you follow on Training.",
  },
```

```ts
  // ro
  builder: {
    title: "Construiește-ți programul",
    namePlaceholder: "Numele programului",
    intensity: "Scara de efort",
    create: "Creează programul",
    addDay: "Adaugă o zi",
    dayNamePlaceholder: "Numele zilei, ex. Piept și triceps",
    muscleGroups: "Grupe musculare",
    addExercise: "Adaugă exercițiu",
    noDays: "Nicio zi încă. Adaug-o pe prima.",
    publish: "Publică",
    published: "Publicat",
    publishHint: "După publicare devine programul pe care îl urmezi la Antrenament.",
  },
```

- [ ] **Step 3: Let ExercisePicker start on a muscle**

`ExercisePicker` holds its filter in `useState("")` with no way to preset it, so
the builder cannot open it already narrowed to the day. Make that optional —
the coach's call sites pass nothing and keep today's behaviour.

In `apps/web/components/exercise-picker.tsx`, extend the props and the state:

```tsx
type Props = {
  muscles: string[];
  equipment: string[];
  /** Called with the exercise the coach picked. Omit to browse read-only. */
  onPick?: (exercise: ExerciseSummary) => void;
  pendingLabel?: string;
  /** Opens the list already filtered — the solo builder passes the day's group. */
  initialMuscle?: string;
};

export function ExercisePicker({ muscles, equipment, onPick, pendingLabel, initialMuscle }: Props) {
```

and change the muscle state line to:

```tsx
  const [muscle, setMuscle] = useState(initialMuscle ?? "");
```

- [ ] **Step 4: Carry muscle_groups into the read model**

In `apps/web/lib/types.ts:119`, change the `ProgramDetail.days` entry to:

```ts
  days: { id: string; name: string; muscle_groups: string[]; exercises: ProgramExerciseRow[] }[];
```

In `apps/web/lib/data.ts`, add `muscle_groups` to the `program_days(...)` select
inside `getProgram`, and map it in both places that build a day — the live
branch of `getProgram` and `toProgramDetail`:

```ts
      muscle_groups: day.muscle_groups ?? [],
```

The demo store has no such field, so `toProgramDetail` maps it as `[]`.

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: 4 tasks successful. A missing key in one locale is a type error — that is the point of the shape being shared.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/muscle-group-picker.tsx apps/web/components/exercise-picker.tsx apps/web/lib/types.ts apps/web/lib/data.ts apps/web/lib/i18n/messages/client-app.ts
git commit -m "Carry a training day's muscle groups through to the picker"
```

---

### Task 6: The builder screen

**Files:**
- Create: `apps/web/app/(client)/workout/build/page.tsx`
- Create: `apps/web/components/solo-program-builder.tsx`
- Modify: `apps/web/app/(client)/workout/page.tsx` (empty state gains a link)

**Interfaces:**
- Consumes: `createSoloProgram`, `addSoloProgramDay`, `getMySoloProgramId`, `addProgramExercise`, `publishProgram` (Task 4); `MuscleGroupPicker`, `MUSCLE_GROUPS` (Task 5); `getProgram` from `@/lib/data`.
- Produces: route `/workout/build`.

- [ ] **Step 1: Create the page**

```tsx
import { getProgram } from "@/lib/data";
import { getMySoloProgramId } from "@/app/builder-actions";
import { SoloProgramBuilder } from "@/components/solo-program-builder";
import { PageTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

export default async function BuildProgramPage() {
  const { t } = await getI18n();
  const programId = await getMySoloProgramId();
  const program = programId ? await getProgram(programId) : null;

  return (
    <div className="space-y-4">
      <PageTitle title={t.clientApp.builder.title} />
      <SoloProgramBuilder program={program} />
    </div>
  );
}
```

- [ ] **Step 2: Create the builder component**

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addProgramExercise, addSoloProgramDay, createSoloProgram, publishProgram,
} from "@/app/builder-actions";
import { ExercisePicker } from "@/components/exercise-picker";
import { MuscleGroupPicker, MUSCLE_GROUPS } from "@/components/muscle-group-picker";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import type { ProgramDetail } from "@/lib/types";

export function SoloProgramBuilder({ program }: { program: ProgramDetail | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [dayName, setDayName] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [pickerDayId, setPickerDayId] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? "Something went wrong");
      router.refresh();
    });
  }

  if (!program) {
    return (
      <Card className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.clientApp.builder.namePlaceholder}
          className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() => run(() => createSoloProgram({ name, intensityMode: "rir" }))}
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {t.clientApp.builder.create}
        </button>
        {error ? <p className="text-sm text-risk">{error}</p> : null}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {program.days.length === 0 ? (
        <p className="text-sm text-ink-faint">{t.clientApp.builder.noDays}</p>
      ) : null}

      {program.days.map((day) => (
        <Card key={day.id} className="space-y-3">
          <p className="font-bold">{day.name}</p>
          {day.muscle_groups.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {day.muscle_groups.map((g) => (
                <span key={g} className="rounded bg-bg px-1.5 py-0.5 text-[10px] capitalize text-ink-faint">
                  {g}
                </span>
              ))}
            </div>
          ) : null}
          {day.exercises.length > 0 ? (
            <ul className="space-y-1 text-sm text-ink-soft">
              {day.exercises.map((e) => (
                <li key={e.id}>
                  {e.exercise} — {e.sets}×{e.reps}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={() => setPickerDayId(pickerDayId === day.id ? null : day.id)}
            className="rounded-lg border border-line px-3 py-2 text-xs font-semibold hover:border-accent"
          >
            {t.clientApp.builder.addExercise}
          </button>
          {pickerDayId === day.id ? (
            <ExercisePicker
              muscles={[...MUSCLE_GROUPS]}
              equipment={[]}
              initialMuscle={day.muscle_groups[0] ?? ""}
              pendingLabel={t.clientApp.builder.addExercise}
              onPick={(exercise) =>
                run(() =>
                  addProgramExercise({
                    programId: program.id,
                    dayId: day.id,
                    exerciseId: exercise.id ?? exercise.external_id,
                    exerciseName: exercise.name_en,
                  }),
                )
              }
            />
          ) : null}
        </Card>
      ))}

      <Card className="space-y-3">
        <input
          value={dayName}
          onChange={(e) => setDayName(e.target.value)}
          placeholder={t.clientApp.builder.dayNamePlaceholder}
          className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          {t.clientApp.builder.muscleGroups}
        </p>
        <MuscleGroupPicker selected={groups} onChange={setGroups} />
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await addSoloProgramDay(program.id, dayName, groups);
              if (r.ok) {
                setDayName("");
                setGroups([]);
              }
              return r;
            })
          }
          className="w-full rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-accent disabled:opacity-40"
        >
          {t.clientApp.builder.addDay}
        </button>
      </Card>

      <button
        type="button"
        disabled={pending || program.status === "published" || program.days.every((d) => d.exercises.length === 0)}
        onClick={() => run(() => publishProgram(program.id))}
        className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {program.status === "published" ? t.clientApp.builder.published : t.clientApp.builder.publish}
      </button>
      <p className="text-xs text-ink-faint">{t.clientApp.builder.publishHint}</p>
      {error ? <p className="text-sm text-risk">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3: Link it from the Training empty state**

In `apps/web/app/(client)/workout/page.tsx`, inside the `days.length === 0` branch, add below `<EmptyState .../>`:

```tsx
          <Link
            href="/workout/build"
            className="mt-3 inline-block rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white"
          >
            {t.clientApp.builder.title}
          </Link>
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run typecheck && npm run build`, then start the preview and, in demo mode (rename `apps/web/.env` aside), walk: `/workout` → build → name it → add a day with two muscle groups → add an exercise → publish → back to `/workout` and confirm the day appears.
Expected: the published day is listed, and opening it shows `SetLogger` with the exercise.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(client)/workout/build/page.tsx" apps/web/components/solo-program-builder.tsx "apps/web/app/(client)/workout/page.tsx"
git commit -m "Add the solo training builder"
```

---

### Task 7: Onboarding choice

**Files:**
- Create: `apps/web/app/(client)/welcome/page.tsx`
- Create: `apps/web/components/welcome-choice.tsx`
- Modify: `apps/web/app/(client)/layout.tsx`
- Modify: `apps/web/lib/i18n/messages/client-app.ts`

**Interfaces:**
- Consumes: `getMySoloProgramId` (Task 4); the existing `accept_invite` RPC.
- Produces: route `/welcome`; `acceptInvite(code: string): Promise<ActionResult>` in `apps/web/app/client-actions.ts`.

- [ ] **Step 1: Add the accept-invite action**

Append to `apps/web/app/client-actions.ts`:

```ts
/**
 * Claim a coach's invite code. The rules — unknown code, expired, already
 * coached — are enforced by the accept_invite() function in the database, and
 * its raised codes are already mapped to message keys in @healthapp/api.
 */
export async function acceptInvite(code: string): Promise<ActionResult> {
  const clean = code.trim().toUpperCase();
  if (!clean) return { ok: false, message: "Enter the code your coach gave you" };
  if (isDemo) return { ok: true, demo: true };

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("accept_invite", { p_code: clean });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/today");
  return { ok: true };
}
```

The parameter name `p_code` matches the signature in
`20260823000900_functions.sql:18` — `accept_invite(p_code text)`, granted to
`authenticated` on line 242.

- [ ] **Step 2: Create the choice component**

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite } from "@/app/client-actions";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";

export function WelcomeChoice() {
  const { t } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<null | "coach">(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <p className="font-bold">{t.clientApp.welcome.withCoachTitle}</p>
        <p className="text-sm text-ink-soft">{t.clientApp.welcome.withCoachBody}</p>
        {mode === "coach" ? (
          <>
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t.clientApp.welcome.codePlaceholder}
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm uppercase outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={pending || !code.trim()}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const r = await acceptInvite(code);
                  if (!r.ok) setError(r.message ?? "Could not use that code");
                  else router.push("/today");
                })
              }
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {t.clientApp.welcome.useCode}
            </button>
            {error ? <p className="text-sm text-risk">{error}</p> : null}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setMode("coach")}
            className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent"
          >
            {t.clientApp.welcome.haveCode}
          </button>
        )}
      </Card>

      <Card className="space-y-2">
        <p className="font-bold">{t.clientApp.welcome.soloTitle}</p>
        <p className="text-sm text-ink-soft">{t.clientApp.welcome.soloBody}</p>
        <button
          type="button"
          onClick={() => router.push("/workout/build")}
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white"
        >
          {t.clientApp.welcome.startSolo}
        </button>
      </Card>

      <p className="text-center text-xs text-ink-faint">{t.clientApp.welcome.notFinal}</p>
    </div>
  );
}
```

- [ ] **Step 3: Create the page**

```tsx
import { WelcomeChoice } from "@/components/welcome-choice";
import { PageTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

export default async function WelcomePage() {
  const { t } = await getI18n();
  return (
    <div className="mx-auto max-w-md space-y-4">
      <PageTitle title={t.clientApp.welcome.title} />
      <WelcomeChoice />
    </div>
  );
}
```

- [ ] **Step 4: Add the copy**

Add a `welcome` section to **both** locales in `apps/web/lib/i18n/messages/client-app.ts`:

```ts
  // en
  welcome: {
    title: "Welcome",
    withCoachTitle: "I have a trainer",
    withCoachBody: "Enter the invite code they gave you and their plans appear here.",
    haveCode: "I have a code",
    codePlaceholder: "Invite code",
    useCode: "Join my coach",
    soloTitle: "I train on my own",
    soloBody: "Build your own week from the exercise library and log it as you go.",
    startSolo: "Build my program",
    notFinal: "You can join a coach later from settings — this is not a one-way door.",
  },
```

```ts
  // ro
  welcome: {
    title: "Bine ai venit",
    withCoachTitle: "Am antrenor",
    withCoachBody: "Introdu codul primit de la el și planurile lui apar aici.",
    haveCode: "Am un cod",
    codePlaceholder: "Cod de invitație",
    useCode: "Conectează-mă",
    soloTitle: "Mă antrenez singur",
    soloBody: "Îți construiești săptămâna din biblioteca de exerciții și o loghezi pe măsură.",
    startSolo: "Construiește-mi programul",
    notFinal: "Poți intra la un antrenor mai târziu, din setări — alegerea nu e definitivă.",
  },
```

- [ ] **Step 5: Redirect empty accounts to the choice**

The redirect goes in `(client)/today/page.tsx`, **not** in the layout. `/welcome`
lives inside the same `(client)` group, so a layout redirect would fire on
`/welcome` itself and loop; `/today` is the only screen an empty account lands
on, which makes the page the right place and costs no extra request elsewhere.

First add the check to `apps/web/lib/client-data.ts`, next to `activeCoachId`
from Task 3:

```ts
/** True when the client has no coach, no program and no nutrition plan yet. */
export async function isEmptyAccount(): Promise<boolean> {
  if (isDemo) return false;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const [coach, programs, plans] = await Promise.all([
    activeCoachId(supabase, auth.user.id),
    supabase.from("programs").select("id", { count: "exact", head: true }).eq("client_id", auth.user.id),
    supabase.from("nutrition_plans").select("id", { count: "exact", head: true }).eq("client_id", auth.user.id),
  ]);
  return coach === null && (programs.count ?? 0) === 0 && (plans.count ?? 0) === 0;
}
```

Then at the top of the component in `apps/web/app/(client)/today/page.tsx`, before
the existing data fetch:

```tsx
  // Nothing to show on Today until the client has a coach or a program of their
  // own, so send a brand-new account to the choice instead of an empty screen.
  // The moment either path is taken this stops firing.
  if (await isEmptyAccount()) redirect("/welcome");
```

with the imports:

```tsx
import { redirect } from "next/navigation";
import { isEmptyAccount } from "@/lib/client-data";
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test && npm run build`.
Then in the browser against live mode, with a freshly created account: signing
in lands on `/welcome`; choosing solo reaches `/workout/build`; creating a
program and returning to `/today` no longer redirects.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(client)/welcome/page.tsx" apps/web/components/welcome-choice.tsx "apps/web/app/(client)/today/page.tsx" apps/web/lib/client-data.ts apps/web/app/client-actions.ts apps/web/lib/i18n/messages/client-app.ts
git commit -m "Ask a new client whether they have a trainer"
```

---

## Verification

- `npm run typecheck` — 4 tasks
- `npm test` — existing suites plus the 5 new `pickProgram` tests
- `npm run build`
- `npx deno check --node-modules-dir=auto supabase/functions/` — unaffected, but cheap
- CI's `database` job applies `20260907090000` to a clean stack
