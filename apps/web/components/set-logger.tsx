"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finishWorkout, logSet } from "@/app/client-actions-app";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";
import type { ClientWorkoutDay, LoggedSetRow } from "@/lib/types";

/**
 * Log a set in three taps: the fields arrive pre-filled from the coach target,
 * so a set that goes to plan is one button press (PRODUCT_SPEC B1). Under the
 * kg / reps / RIR boxes sit a 1–10 intensity slider and a one-line note, both
 * optional, so the set can carry how it felt as well as what it was.
 */
export function SetLogger({ day }: { day: ClientWorkoutDay }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [logged, setLogged] = useState(day.logged);
  const [error, setError] = useState<string | null>(null);
  const [pr, setPr] = useState<string | null>(null);

  // Grouped by the prescribed row, not the exercise name: a day may program the
  // same lift twice (heavy, then a back-off block) and each block owns its own
  // count and set numbering. Rows with no link — demo history, sets logged
  // before program_exercise_id was carried through — fall back to the name.
  const setsFor = useMemo(() => {
    const byBlock = new Map<string, LoggedSetRow[]>();
    for (const exercise of day.exercises) {
      byBlock.set(
        exercise.id,
        logged.filter((s) =>
          s.program_exercise_id
            ? s.program_exercise_id === exercise.id
            : s.exercise === exercise.exercise,
        ),
      );
    }
    return byBlock;
  }, [logged, day.exercises]);

  const totalTarget = day.exercises.reduce((sum, e) => sum + e.sets, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${totalTarget ? (logged.length / totalTarget) * 100 : 0}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-ink-faint">
          {fill(t.clientWidgets.setLogger.setsProgress, { done: logged.length, total: totalTarget })}
        </span>
      </div>

      {pr ? (
        <Card className="border-accent bg-accent-soft">
          <p className="text-sm font-bold text-accent-ink">
            {fill(t.clientWidgets.setLogger.personalRecord, { name: pr })}
          </p>
          <p className="mt-0.5 text-xs text-accent-ink">
            {t.clientWidgets.setLogger.personalRecordDetail}
          </p>
        </Card>
      ) : null}
      {error ? (
        <Card className="border-risk bg-risk-soft">
          <p className="text-sm font-semibold text-risk">{error}</p>
        </Card>
      ) : null}

      {day.exercises.map((exercise) => {
        const blockSets = setsFor.get(exercise.id) ?? [];
        const done = blockSets.length;
        return (
          <ExerciseBlock
            key={exercise.id}
            name={exercise.exercise}
            targetSets={exercise.sets}
            targetReps={exercise.reps}
            targetWeight={exercise.weight_kg}
            targetRpe={exercise.rpe_value}
            rest={exercise.rest}
            intensityMode={day.intensity_mode}
            done={done}
            sets={blockSets}
            pending={pending}
            onLog={(entry) =>
              startTransition(async () => {
                setError(null);
                setPr(null);
                const result = await logSet({
                  dayId: day.day_id,
                  dayName: day.day_name,
                  exerciseName: exercise.exercise,
                  exerciseId: exercise.exercise_id ?? null,
                  programExerciseId: exercise.id,
                  setIndex: done + 1,
                  weightKg: entry.weight,
                  reps: entry.reps,
                  rpe: entry.intensity,
                  rir: entry.rir,
                  notes: entry.notes,
                });
                if (!result.ok) {
                  setError(result.message ?? t.clientWidgets.setLogger.couldNotLogSet);
                  return;
                }
                setLogged((prev) => [
                  ...prev,
                  {
                    id: `tmp_${prev.length}`,
                    program_exercise_id: exercise.id,
                    exercise: exercise.exercise,
                    set_index: done + 1,
                    weight_kg: entry.weight,
                    reps: entry.reps,
                    rpe: entry.intensity,
                    rir: entry.rir,
                    notes: entry.notes,
                    is_pr: Boolean(result.is_pr),
                    at: new Date().toISOString(),
                  },
                ]);
                if (result.is_pr) setPr(exercise.exercise);
                router.refresh();
              })
            }
          />
        );
      })}

      <button
        type="button"
        disabled={pending || logged.length === 0}
        onClick={() =>
          startTransition(async () => {
            const result = await finishWorkout(day.day_id);
            if (!result.ok) setError(result.message ?? t.clientWidgets.setLogger.couldNotFinish);
            else router.push("/today");
          })
        }
        className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-fg disabled:opacity-40"
      >
        {t.clientWidgets.setLogger.finishWorkout}
      </button>
    </div>
  );
}

type SetEntry = {
  weight: number;
  reps: number;
  /** 1..10 from the slider. */
  intensity: number;
  /** Reps in reserve as typed, RIR-mode programs only. */
  rir: number | null;
  notes: string | null;
};

function ExerciseBlock({
  name, targetSets, targetReps, targetWeight, targetRpe, rest, intensityMode,
  done, sets, pending, onLog,
}: {
  name: string;
  targetSets: number;
  targetReps: string;
  targetWeight: number | null;
  targetRpe: number | null;
  rest: string;
  intensityMode: "rpe" | "rir" | "simple";
  done: number;
  sets: Pick<LoggedSetRow, "id" | "set_index" | "weight_kg" | "reps" | "rpe" | "rir" | "notes" | "is_pr">[];
  pending: boolean;
  onLog: (entry: SetEntry) => void;
}) {
  const { t } = useI18n();
  const m = t.clientWidgets.setLogger;
  // program_exercises.target_rpe holds whatever the coach typed under the
  // program's own scale: RIR for an RIR program, RPE otherwise (the builder
  // writes the column raw). In RIR mode the box shows that number as reps in
  // reserve and saves it to logged_sets.rir; the slider is always the felt
  // intensity 1..10 (logged_sets.rpe), pre-set from the target — RIR 2 ≈ 8/10.
  const asRir = intensityMode === "rir";
  const [weight, setWeight] = useState(targetWeight?.toString() ?? "");
  const [reps, setReps] = useState(parseInt(targetReps, 10) ? String(parseInt(targetReps, 10)) : "");
  const [rir, setRir] = useState(asRir && targetRpe !== null ? String(targetRpe) : "");
  const [intensity, setIntensity] = useState<number>(
    targetRpe === null ? 7 : Math.round(clamp(asRir ? 10 - targetRpe : targetRpe, 1, 10)),
  );
  const [notes, setNotes] = useState("");
  const complete = done >= targetSets;

  function submit() {
    const rirValue = asRir && rir.trim() !== "" ? clamp(parseFloat(rir), 0, 10) : null;
    onLog({
      weight: parseFloat(weight),
      reps: parseInt(reps, 10),
      intensity,
      rir: rirValue !== null && Number.isFinite(rirValue) ? rirValue : null,
      notes: notes.trim() || null,
    });
    setNotes("");
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold">{name}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {targetSets}×{targetReps}
            {targetWeight ? ` · ${targetWeight} kg` : ""} · {m.rest} {rest}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${
            complete ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
          }`}
        >
          {done}/{targetSets}
        </span>
      </div>

      {sets.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {sets.map((s) => (
            <li
              key={s.id}
              title={s.notes ?? undefined}
              className={`rounded-md px-2 py-1 text-xs tabular-nums ${
                s.is_pr ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft"
              }`}
            >
              {s.weight_kg} kg × {s.reps}
              {s.rir !== null ? ` · ${m.rir} ${s.rir}` : ""}
              {s.rpe !== null ? ` · ${s.rpe}/10` : ""}
              {s.is_pr ? ` · ${m.pr}` : ""}
              {s.notes ? " · ✎" : ""}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label={m.kg} value={weight} onChange={setWeight} />
        <Field label={m.reps} value={reps} onChange={setReps} />
        {asRir ? <Field label={m.rir} value={rir} onChange={setRir} /> : null}
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-40"
        >
          {m.logSet}
        </button>
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <label htmlFor={`intensity-${name}`} className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {m.intensity}
          </label>
          <span className="text-xs tabular-nums">
            <b className="text-ink">{intensity}</b>
            <span className="text-ink-faint">/10</span>
          </span>
        </div>
        <input
          id={`intensity-${name}`}
          type="range"
          min={1}
          max={10}
          step={1}
          value={intensity}
          onChange={(e) => setIntensity(parseInt(e.target.value, 10))}
          className="mt-1 w-full"
        />
        <p className="text-[10px] text-ink-faint">{m.intensityScale}</p>
      </div>

      <label className="mt-2 flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{m.note}</span>
        <input
          value={notes}
          maxLength={500}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={m.notePlaceholder}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>
    </Card>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function Field({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 rounded-lg border border-line bg-surface px-2 py-2 text-sm tabular-nums outline-none focus:border-accent"
      />
    </label>
  );
}
