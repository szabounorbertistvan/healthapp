"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { exerciseRef, type ExerciseSummary } from "@buddygym/shared";
import type { ProgramDetail, ProgramExerciseRow } from "@/lib/types";
import {
  addProgramDay,
  addProgramExercise,
  duplicateProgramDay,
  publishProgram,
  removeProgramExercise,
  updateProgramExercise,
} from "@/app/builder-actions";
import { ExercisePicker } from "@/components/exercise-picker";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";

// W4 · Program builder. The wireframe puts the library in a left rail and the
// days as columns; here the library opens as a panel next to the day being
// edited, which keeps the same two-region shape on a laptop screen.

type Props = {
  program: ProgramDetail;
  muscles: string[];
  equipment: string[];
};

export function ProgramBuilder({ program, muscles, equipment }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.coachWidgets.programBuilder;
  const [pickerDayId, setPickerDayId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? m.somethingWentWrong);
      router.refresh();
    });
  }

  const isEmpty = program.days.every((d) => d.exercises.length === 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={program.status} />
          <span className="text-sm text-ink-soft">
            {program.client_name} ·{" "}
            {fill(
              program.weeks === 1 ? m.weeksOne : program.weeks < 20 ? m.weeksFew : m.weeksMany,
              { n: program.weeks },
            )}{" "}
            · {program.intensity_mode.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {error ? <span className="text-sm text-risk">{error}</span> : null}
          <button
            onClick={() =>
              run(() =>
                addProgramDay(program.id, fill(m.dayDefaultName, { n: program.days.length + 1 })),
              )
            }
            disabled={pending}
            className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-accent disabled:opacity-50"
          >
            {m.addDay}
          </button>
          <button
            onClick={() => run(() => publishProgram(program.id))}
            disabled={pending || isEmpty || program.status === "published"}
            title={isEmpty ? m.publishHint : undefined}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {program.status === "published" ? m.published : m.publish}
          </button>
        </div>
      </div>

      {program.status !== "published" ? (
        <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
          {fill(m.draftNotice, { name: program.client_name })}
        </p>
      ) : null}

      <div className="space-y-4">
        {program.days.length === 0 ? (
          <Card className="py-10 text-center">
            <p className="font-semibold">{m.noDaysTitle}</p>
            <p className="mt-1 text-sm text-ink-soft">{m.noDaysBody}</p>
          </Card>
        ) : null}

        {program.days.map((day) => {
          const picking = pickerDayId === day.id;
          return (
            <Card key={day.id}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="font-bold">{day.name}</p>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => setPickerDayId(picking ? null : day.id)}
                    className="rounded-lg border border-line px-2 py-1 font-semibold hover:border-accent hover:text-accent-ink"
                  >
                    {picking ? m.closeLibrary : m.addExercise}
                  </button>
                  <button
                    onClick={() => run(() => duplicateProgramDay(program.id, day.id))}
                    disabled={pending}
                    className="rounded-lg border border-line px-2 py-1 hover:border-accent disabled:opacity-50"
                  >
                    {m.duplicate}
                  </button>
                </div>
              </div>

              {/* The library opens inside the day it belongs to: with several
                  days on screen, a panel anywhere else leaves the coach guessing
                  which day an exercise would land in. */}
              <div className="flex flex-col gap-4 lg:flex-row">
                <div className="min-w-0 flex-1">
                  {day.exercises.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-faint">
                      {m.noExercises}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[34rem] text-sm">
                        <thead>
                          <tr className="border-b-2 border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                            <th className="py-2 pr-3">{m.colExercise}</th>
                            <th className="py-2 pr-2 w-16">{m.colSets}</th>
                            <th className="py-2 pr-2 w-20">{m.colReps}</th>
                            <th className="py-2 pr-2 w-20">{m.colKg}</th>
                            <th className="py-2 pr-2 w-16">
                              {program.intensity_mode === "rpe" ? "RPE" : "RIR"}
                            </th>
                            <th className="py-2 pr-2 w-20">{m.colRest}</th>
                            <th className="py-2 w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {day.exercises.map((row) => (
                            <ExerciseRow
                              key={row.id}
                              row={row}
                              disabled={pending}
                              onSave={(values) =>
                                run(() =>
                                  updateProgramExercise({
                                    programId: program.id,
                                    exerciseRowId: row.id,
                                    ...values,
                                  }),
                                )
                              }
                              onRemove={() => run(() => removeProgramExercise(program.id, row.id))}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {picking ? (
                  <div className="flex h-[30rem] w-full shrink-0 flex-col rounded-lg border border-line bg-bg p-3 lg:w-80">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                      {fill(m.addTo, { name: day.name })}
                    </p>
                    <ExercisePicker
                      muscles={muscles}
                      equipment={equipment}
                      onPick={(exercise: ExerciseSummary) =>
                        run(() =>
                          addProgramExercise({
                            programId: program.id,
                            dayId: day.id,
                            exerciseId: exerciseRef(exercise),
                            exerciseName: exercise.name_en,
                          }),
                        )
                      }
                    />
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

type Values = {
  target_sets: number;
  target_reps: string;
  target_weight_kg: number | null;
  target_rpe: number | null;
  rest_seconds: number | null;
};

function ExerciseRow({
  row,
  disabled,
  onSave,
  onRemove,
}: {
  row: ProgramExerciseRow;
  disabled: boolean;
  onSave: (values: Values) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  // Local state so typing does not fight the server round-trip.
  const [values, setValues] = useState<Values>({
    target_sets: row.sets,
    target_reps: row.reps,
    target_weight_kg: row.weight_kg,
    target_rpe: row.rpe_value,
    rest_seconds: row.rest_seconds,
  });

  // The blur handler must not read `values` from its closure: a change and the
  // blur that follows it can land in the same React batch, and the handler
  // would then save the values from before the edit. The ref is always current.
  const latest = useRef(values);

  function change(next: Values) {
    latest.current = next;
    setValues(next);
  }

  function commit() {
    onSave(latest.current);
  }

  // Blur is the natural commit point, but a value typed into the last cell and
  // never left would be lost — Enter commits it too.
  function commitOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
  }

  const cell =
    "w-full min-w-14 rounded border border-line bg-bg px-1.5 py-1 text-sm tabular-nums outline-none focus:border-accent";

  const numeric = (raw: string): number | null => (raw === "" ? null : Number(raw));

  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-1.5 pr-3 font-medium">{row.exercise}</td>
      <td className="py-1.5 pr-2">
        <input
          type="number" min={1} max={20} value={values.target_sets} disabled={disabled}
          onChange={(e) => change({ ...latest.current, target_sets: Number(e.target.value) })}
          onBlur={commit} onKeyDown={commitOnEnter} className={cell}
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          value={values.target_reps} disabled={disabled} placeholder="8-10"
          onChange={(e) => change({ ...latest.current, target_reps: e.target.value })}
          onBlur={commit} onKeyDown={commitOnEnter} className={cell}
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          type="number" step="0.5" value={values.target_weight_kg ?? ""} disabled={disabled}
          onChange={(e) => change({ ...latest.current, target_weight_kg: numeric(e.target.value) })}
          onBlur={commit} onKeyDown={commitOnEnter} className={cell}
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          type="number" step="0.5" min={1} max={10} value={values.target_rpe ?? ""} disabled={disabled}
          onChange={(e) => change({ ...latest.current, target_rpe: numeric(e.target.value) })}
          onBlur={commit} onKeyDown={commitOnEnter} className={cell}
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          type="number" step={15} min={0} max={600} value={values.rest_seconds ?? ""} disabled={disabled}
          onChange={(e) => change({ ...latest.current, rest_seconds: numeric(e.target.value) })}
          onBlur={commit} onKeyDown={commitOnEnter} className={cell}
        />
      </td>
      <td className="py-1.5">
        <button
          onClick={onRemove}
          disabled={disabled}
          title={t.coachWidgets.programBuilder.removeExercise}
          className="rounded px-1.5 py-0.5 text-ink-faint hover:bg-risk-soft hover:text-risk disabled:opacity-50"
        >
          ×
        </button>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: ProgramDetail["status"] }) {
  const { t } = useI18n();
  const styles =
    status === "published" ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint";
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${styles}`}>
      {t.coachWidgets.programBuilder.status[status]}
    </span>
  );
}
