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
            // Keyed by day id so switching days always remounts the picker
            // rather than reusing one whose `initialMuscle` was read once at
            // mount time — otherwise the filter would keep showing the first
            // day's muscle group after switching to a day with a different one.
            <ExercisePicker
              key={day.id}
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
