"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finishWorkout, logSet } from "@/app/client-actions-app";
import { Card } from "./ui";
import type { ClientWorkoutDay, LoggedSetRow } from "@/lib/types";

/**
 * Log a set in three taps: the fields arrive pre-filled from the coach target,
 * so a set that goes to plan is one button press (PRODUCT_SPEC B1).
 */
export function SetLogger({ day }: { day: ClientWorkoutDay }) {
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
          {logged.length}/{totalTarget} sets
        </span>
      </div>

      {pr ? (
        <Card className="border-accent bg-accent-soft">
          <p className="text-sm font-bold text-accent-ink">Personal record — {pr}</p>
          <p className="mt-0.5 text-xs text-accent-ink">
            Best estimated 1RM for this lift. Nice work.
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
            onLog={(weight, reps, rpe) =>
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
                  weightKg: weight,
                  reps,
                  rpe,
                });
                if (!result.ok) {
                  setError(result.message ?? "Could not log that set");
                  return;
                }
                setLogged((prev) => [
                  ...prev,
                  {
                    id: `tmp_${prev.length}`,
                    program_exercise_id: exercise.id,
                    exercise: exercise.exercise,
                    set_index: done + 1,
                    weight_kg: weight,
                    reps,
                    rpe,
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
            if (!result.ok) setError(result.message ?? "Could not finish");
            else router.push("/today");
          })
        }
        className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        Finish workout
      </button>
    </div>
  );
}

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
  sets: { id: string; set_index: number; weight_kg: number; reps: number; is_pr: boolean }[];
  pending: boolean;
  onLog: (weight: number, reps: number, rpe: number | null) => void;
}) {
  // program_exercises.target_rpe and logged_sets.rpe are both RPE, constrained
  // to 1..10. When the coach set the program to RIR the field shows and takes
  // reps-in-reserve — RIR 0 is a normal answer, RPE 0 is not — and converts on
  // the way in and out.
  const asRir = intensityMode === "rir";
  const [weight, setWeight] = useState(targetWeight?.toString() ?? "");
  const [reps, setReps] = useState(parseInt(targetReps, 10) ? String(parseInt(targetReps, 10)) : "");
  const [effort, setEffort] = useState(
    targetRpe === null ? "" : String(asRir ? Math.max(0, 10 - targetRpe) : targetRpe),
  );
  const complete = done >= targetSets;

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold">{name}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {targetSets}×{targetReps}
            {targetWeight ? ` · ${targetWeight} kg` : ""} · rest {rest}
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
              className={`rounded-md px-2 py-1 text-xs tabular-nums ${
                s.is_pr ? "bg-accent text-white" : "bg-bg text-ink-soft"
              }`}
            >
              {s.weight_kg} kg × {s.reps}
              {s.is_pr ? " · PR" : ""}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label="kg" value={weight} onChange={setWeight} />
        <Field label="reps" value={reps} onChange={setReps} />
        <Field label={asRir ? "RIR" : "RPE"} value={effort} onChange={setEffort} />
        <button
          type="button"
          disabled={pending}
          onClick={() => onLog(parseFloat(weight), parseInt(reps, 10), toRpe(effort, asRir))}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Log set
        </button>
      </div>
    </Card>
  );
}

/** The effort field as logged_sets.rpe wants it: 1..10, or null when blank. */
function toRpe(value: string, asRir: boolean): number | null {
  if (value.trim() === "") return null;
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) return null;
  const rpe = asRir ? 10 - parsed : parsed;
  return Math.min(Math.max(rpe, 1), 10);
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
