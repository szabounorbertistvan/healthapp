"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finishWorkout, logSet } from "@/app/client-actions-app";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";
import type { ClientWorkoutDay } from "@/lib/types";

/**
 * Log a set in three taps: the fields arrive pre-filled from the coach target,
 * so a set that goes to plan is one button press (PRODUCT_SPEC B1).
 */
export function SetLogger({ day }: { day: ClientWorkoutDay }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [logged, setLogged] = useState(day.logged);
  const [error, setError] = useState<string | null>(null);
  const [pr, setPr] = useState<string | null>(null);

  const doneByExercise = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of logged) map.set(s.exercise, (map.get(s.exercise) ?? 0) + 1);
    return map;
  }, [logged]);

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
        const done = doneByExercise.get(exercise.exercise) ?? 0;
        return (
          <ExerciseBlock
            key={exercise.id}
            name={exercise.exercise}
            targetSets={exercise.sets}
            targetReps={exercise.reps}
            targetWeight={exercise.weight_kg}
            targetRpe={exercise.rpe_value}
            rest={exercise.rest}
            done={done}
            sets={logged.filter((l) => l.exercise === exercise.exercise)}
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
                  setError(result.message ?? t.clientWidgets.setLogger.couldNotLogSet);
                  return;
                }
                setLogged((prev) => [
                  ...prev,
                  {
                    id: `tmp_${prev.length}`,
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
            if (!result.ok) setError(result.message ?? t.clientWidgets.setLogger.couldNotFinish);
            else router.push("/today");
          })
        }
        className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {t.clientWidgets.setLogger.finishWorkout}
      </button>
    </div>
  );
}

function ExerciseBlock({
  name, targetSets, targetReps, targetWeight, targetRpe, rest, done, sets, pending, onLog,
}: {
  name: string;
  targetSets: number;
  targetReps: string;
  targetWeight: number | null;
  targetRpe: number | null;
  rest: string;
  done: number;
  sets: { id: string; set_index: number; weight_kg: number; reps: number; is_pr: boolean }[];
  pending: boolean;
  onLog: (weight: number, reps: number, rpe: number | null) => void;
}) {
  const { t } = useI18n();
  const [weight, setWeight] = useState(targetWeight?.toString() ?? "");
  const [reps, setReps] = useState(parseInt(targetReps, 10) ? String(parseInt(targetReps, 10)) : "");
  const [rpe, setRpe] = useState(targetRpe?.toString() ?? "");
  const complete = done >= targetSets;

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold">{name}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {targetSets}×{targetReps}
            {targetWeight ? ` · ${targetWeight} kg` : ""} · {t.clientWidgets.setLogger.rest} {rest}
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
              {s.is_pr ? ` · ${t.clientWidgets.setLogger.pr}` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label={t.clientWidgets.setLogger.kg} value={weight} onChange={setWeight} />
        <Field label={t.clientWidgets.setLogger.reps} value={reps} onChange={setReps} />
        <Field label={t.clientWidgets.setLogger.rir} value={rpe} onChange={setRpe} />
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            onLog(parseFloat(weight), parseInt(reps, 10), rpe === "" ? null : parseFloat(rpe))
          }
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {t.clientWidgets.setLogger.logSet}
        </button>
      </div>
    </Card>
  );
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
