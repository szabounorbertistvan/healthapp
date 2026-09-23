"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  circuitSegments, displayToKg, kgToDisplay, parseDecimal, resolveRestSeconds, restAfterLoggedSet,
  type ExerciseVideoSource,
} from "@healthapp/shared";
import { finishWorkout, logSet } from "@/app/client-actions-app";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";
import { NavIcon } from "./client-nav";
import { EditSet } from "./edit-set";
import { ExerciseVideo } from "./exercise-video";
import { RestDurationPicker } from "./rest-settings";
import { useRestTimer } from "@/lib/rest-timer/client";
import { useUnits } from "@/lib/units/client";
import type { LastPerformance } from "@/lib/client-training";
import type { ClientWorkoutDay, LoggedSetRow } from "@/lib/types";

/**
 * Log a set in three taps: the fields arrive pre-filled, so a set that goes to
 * plan is one button press (PRODUCT_SPEC B1). Under the kg / reps / RIR boxes
 * sit a 1–10 intensity slider and a one-line note, both optional, so the set
 * can carry how it felt as well as what it was.
 *
 * `last` is what this person actually lifted on each exercise the last time
 * (getLastPerformance). It wins over the coach's target for the pre-fill: the
 * number you used yesterday is the better guess at the number you want today,
 * and it is the one a solo program has at all.
 */
export function SetLogger({ day, last = {} }: { day: ClientWorkoutDay; last?: Record<string, LastPerformance> }) {
  const { t } = useI18n();
  const u = useUnits();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [logged, setLogged] = useState(day.logged);
  const [error, setError] = useState<string | null>(null);
  const [pr, setPr] = useState<string | null>(null);
  const rest = useRestTimer();

  // Grouped by the prescribed row, not the exercise name: a day may program the
  // same lift twice (heavy, then a back-off block) and each block owns its own
  // count and set numbering. Rows with no link — sets logged before
  // program_exercise_id was carried through — fall back to the name.
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
        <div className="h-2.5 flex-1 overflow-hidden rounded-md bg-surface">
          <div
            className="h-full rounded-md bg-accent transition-all"
            style={{ width: `${totalTarget ? (logged.length / totalTarget) * 100 : 0}%` }}
          />
        </div>
        <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-ink-faint">
          {fill(t.clientWidgets.setLogger.setsProgress, { done: logged.length, total: totalTarget })}
        </span>
      </div>

      {pr ? (
        <div className="rounded-3xl bg-accent-soft px-5 py-[18px]">
          <p className="font-display text-base font-bold text-accent-ink">
            {fill(t.clientWidgets.setLogger.personalRecord, { name: pr })}
          </p>
          <p className="mt-1 text-[12.5px] text-accent-ink">
            {t.clientWidgets.setLogger.personalRecordDetail}
          </p>
        </div>
      ) : null}
      {error ? (
        <Card plain className="bg-risk-soft">
          <p className="text-sm font-semibold text-risk">{error}</p>
        </Card>
      ) : null}

      {/* As many columns as fit, never a block under 420px — one on a phone,
          several across a wide window. A circuit stays one cell. */}
      <div className="grid gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(420px,1fr))]">
      {circuitSegments(day.exercises).map((seg, si) => (
        <div
          key={seg.circuit ?? `solo-${si}`}
          className={seg.circuit !== null ? "space-y-2.5 rounded-[20px] border-l-[3px] border-accent bg-accent-soft/55 p-2 pl-[9px]" : ""}
        >
          {seg.label ? (
            <p className="flex items-center gap-1.5 px-2.5 pt-1 text-[10.5px] font-bold uppercase tracking-wider text-accent-ink">
              <NavIcon d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" className="h-[13px] w-[13px]" />
              {fill(t.coachWidgets.programBuilder.circuitName, { label: seg.label })} · {t.clientWidgets.setLogger.circuitHint}
            </p>
          ) : null}
      {seg.exercises.map((exercise) => {
        const blockSets = setsFor.get(exercise.id) ?? [];
        const done = blockSets.length;
        // Today's own sets first, then last session's, then the prescription.
        const previous = last[exercise.id] ?? (exercise.exercise_id ? last[exercise.exercise_id] : undefined) ?? last[exercise.exercise];
        return (
          <ExerciseBlock
            key={exercise.id}
            name={exercise.exercise}
            targetSets={exercise.sets}
            targetReps={exercise.reps}
            targetWeight={exercise.weight_kg}
            lastWeightKg={previous?.weight_kg ?? null}
            lastReps={previous?.reps ?? null}
            targetRpe={exercise.rpe_value}
            rest={exercise.rest}
            restSeconds={exercise.rest_seconds}
            exerciseId={exercise.exercise_id ?? null}
            videoUrl={exercise.video_url ?? null}
            videoSource={exercise.video_source ?? null}
            intensityMode={day.intensity_mode}
            done={done}
            sets={blockSets}
            pending={pending}
            dayId={day.day_id}
            onEdited={(updated) => setLogged((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))}
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
                  // entry.weight is in the unit on screen; the column is kg.
                  weightKg: displayToKg(entry.weight, u.weightUnit),
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
                    weight_kg: displayToKg(entry.weight, u.weightUnit),
                    reps: entry.reps,
                    rpe: entry.intensity,
                    rir: entry.rir,
                    notes: entry.notes,
                    is_pr: Boolean(result.is_pr),
                    at: new Date().toISOString(),
                  },
                ]);
                if (result.is_pr) setPr(exercise.exercise);
                // The set is saved: now, and only now, the rest starts — for
                // the resolved duration, towards the next planned set, and
                // not at all after the workout's final set.
                const loggedCount: Record<string, number> = {};
                for (const [blockId, sets] of setsFor) loggedCount[blockId] = sets.length;
                loggedCount[exercise.id] = done + 1;
                const plan = restAfterLoggedSet({
                  saved: true,
                  day: { exercises: day.exercises, completed: day.completed },
                  loggedCount,
                  justLogged: {
                    programExerciseId: exercise.id,
                    exerciseId: exercise.exercise_id ?? null,
                    setIndex: done + 1,
                    prescribedSeconds: exercise.rest_seconds,
                    restSecondsForThisSet: entry.restSeconds,
                  },
                  prefs: rest.prefs,
                });
                if (plan) rest.start(plan, { dayId: day.day_id, exerciseName: exercise.exercise, setIndex: done + 1 });
                router.refresh();
              })
            }
          />
        );
      })}
        </div>
      ))}
      </div>

      <button
        type="button"
        disabled={pending || logged.length === 0}
        onClick={() =>
          startTransition(async () => {
            const result = await finishWorkout(day.day_id);
            if (!result.ok) {
              setError(result.message ?? t.clientWidgets.setLogger.couldNotFinish);
              return;
            }
            // The workout is over: whatever rest was counting down is moot.
            rest.clear();
            // The done screen offers to share the session; without an id it falls back to Today.
            router.push(result.sessionId ? `/workout/${day.day_id}/done?session=${result.sessionId}` : "/today");
          })
        }
        className="flex h-12 w-full items-center justify-center rounded-2xl bg-accent px-5 font-display text-[15px] font-bold text-accent-fg disabled:opacity-40"
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
  /** The REST box, seconds: the pause that starts after this set. Null when left empty. */
  restSeconds: number | null;
};

function ExerciseBlock({
  name, targetSets, targetReps, targetWeight, lastWeightKg, lastReps, targetRpe, rest, restSeconds, exerciseId, videoUrl, videoSource, intensityMode,
  done, sets, pending, dayId, onLog, onEdited,
}: {
  name: string;
  targetSets: number;
  targetReps: string;
  targetWeight: number | null;
  /** What this person lifted here last time, in kilograms; null the first time. */
  lastWeightKg: number | null;
  lastReps: number | null;
  targetRpe: number | null;
  rest: string;
  /** The coach's prescribed rest, raw; the timer resolves it against the person's own settings. */
  restSeconds: number | null;
  /** exercises.id — the key of a per-lift rest override; null when the row has no library link. */
  exerciseId: string | null;
  /** The resolved demo video (yours, your coach's, or the exercise's), and whose it is. */
  videoUrl: string | null;
  videoSource: ExerciseVideoSource | null;
  intensityMode: "rpe" | "rir" | "simple";
  done: number;
  sets: Pick<LoggedSetRow, "id" | "set_index" | "weight_kg" | "reps" | "rpe" | "rir" | "notes" | "is_pr">[];
  pending: boolean;
  dayId: string;
  onLog: (entry: SetEntry) => void;
  onEdited: (set: Pick<LoggedSetRow, "id" | "weight_kg" | "reps" | "rpe" | "rir" | "notes" | "is_pr">) => void;
}) {
  const { t } = useI18n();
  const u = useUnits();
  const m = t.clientWidgets.setLogger;
  // program_exercises.target_rpe holds whatever the coach typed under the
  // program's own scale: RIR for an RIR program, RPE otherwise (the builder
  // writes the column raw). In RIR mode the box shows that number as reps in
  // reserve and saves it to logged_sets.rir; the slider is always the felt
  // intensity 1..10 (logged_sets.rpe), pre-set from the target — RIR 2 ≈ 8/10.
  const asRir = intensityMode === "rir";
  // Both the coach's target and the remembered weight are stored in kilograms;
  // the box is in the reader's unit, so pre-filling either raw would put 100
  // into a pound field and log 45 kg.
  //
  // Today's last set wins over the previous session's, which wins over the
  // prescription: once you have logged set 1 at 62.5 kg, set 2 opens at 62.5.
  const doneToday = sets.length > 0 ? sets[sets.length - 1] : null;
  const rememberedKg = doneToday?.weight_kg ?? (lastWeightKg && lastWeightKg > 0 ? lastWeightKg : null);
  const initialKg = rememberedKg ?? targetWeight;
  const initialReps = doneToday?.reps ?? (lastReps && lastReps > 0 ? lastReps : null) ?? (parseInt(targetReps, 10) || null);
  const [weight, setWeight] = useState(
    initialKg === null ? "" : String(kgToDisplay(initialKg, u.weightUnit)),
  );
  const [reps, setReps] = useState(initialReps ? String(initialReps) : "");
  const [rir, setRir] = useState(asRir && targetRpe !== null ? String(targetRpe) : "");
  const [intensity, setIntensity] = useState<number>(
    targetRpe === null ? 7 : Math.round(clamp(asRir ? 10 - targetRpe : targetRpe, 1, 10)),
  );
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [restPicker, setRestPicker] = useState(false);
  const complete = done >= targetSets;
  // The REST box sits next to kg / reps / RIR and holds the pause that will
  // start after the set being logged — per set, editable like the others.
  // It is pre-filled the way the timer would resolve it anyway: the person's
  // own default for this lift, else the coach's `rest`, else their default.
  // Saving a new default (the picker under the label) re-fills it.
  const { prefs: restPrefs } = useRestTimer();
  const effectiveRest = resolveRestSeconds({ exerciseId, prescribedSeconds: restSeconds, prefs: restPrefs });
  const [restInput, setRestInput] = useState(String(effectiveRest));
  useEffect(() => {
    setRestInput(String(effectiveRest));
  }, [effectiveRest]);

  function submit() {
    const rirValue = asRir && rir.trim() !== "" ? clamp(parseFloat(rir), 0, 10) : null;
    const restTyped = restInput.trim() === "" ? null : parseInt(restInput, 10);
    onLog({
      weight: parseDecimal(weight) ?? NaN,
      reps: parseInt(reps, 10),
      intensity,
      rir: rirValue !== null && Number.isFinite(rirValue) ? rirValue : null,
      notes: notes.trim() || null,
      restSeconds: restTyped !== null && Number.isFinite(restTyped) ? restTyped : null,
    });
    setNotes("");
  }

  return (
    <Card plain className="h-full">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold tracking-tight">{name}</p>
          <p className="mt-1 text-[12.5px] tabular-nums text-ink-faint">
            {targetSets}×{targetReps}
            {targetRpe !== null ? ` · ${asRir ? m.rir : m.rpe} ${targetRpe}` : ""}
            {targetWeight ? ` · ${kgToDisplay(targetWeight, u.weightUnit)} ${u.weightUnit}` : ""} · {m.rest} {rest}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold tabular-nums ${
            complete ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
          }`}
        >
          {done}/{targetSets}
        </span>
      </div>

      {exerciseId ? (
        <div className="mt-2">
          <ExerciseVideo exerciseId={exerciseId} videoUrl={videoUrl} source={videoSource} collapsed />
        </div>
      ) : null}

      {sets.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {sets.map((s) => (
            <li key={s.id}>
              {/* A logged set is a button: tap to correct it. Rows still in
                  flight (tmp_ ids) are not editable until the refresh lands. */}
              <button
                type="button"
                title={s.notes ?? m.editSet}
                aria-label={`${m.editSet}: ${kgToDisplay(s.weight_kg, u.weightUnit)} ${u.weightUnit} × ${s.reps}`}
                disabled={s.id.startsWith("tmp_")}
                onClick={() => setEditing(editing === s.id ? null : s.id)}
                className={`min-h-8 rounded-[10px] px-2.5 py-1.5 text-xs tabular-nums ${
                  s.is_pr ? "bg-accent font-semibold text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"
                } ${editing === s.id ? "ring-2 ring-accent-ink" : ""}`}
              >
                {kgToDisplay(s.weight_kg, u.weightUnit)} {u.weightUnit} × {s.reps}
                {s.rir !== null ? ` · ${m.rir} ${s.rir}` : ""}
                {s.rpe !== null ? ` · ${s.rpe}/10` : ""}
                {s.is_pr ? ` · ${m.pr}` : ""}
                {s.notes ? " · ✎" : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? (() => {
        const target = sets.find((x) => x.id === editing);
        return target ? (
          <EditSet
            set={target}
            asRir={asRir}
            dayId={dayId}
            onDone={(updated) => { setEditing(null); if (updated) onEdited(updated); }}
          />
        ) : null;
      })() : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label={u.weightUnit} value={weight} onChange={setWeight} />
        <Field label={m.reps} value={reps} onChange={setReps} />
        {asRir ? <Field label={m.rir} value={rir} onChange={setRir} /> : null}
        {/* The pause after this set, in seconds. The label opens the presets,
            which also save the value as this lift's default. */}
        <label className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setRestPicker((v) => !v)}
            aria-expanded={restPicker}
            disabled={!exerciseId}
            className="inline-flex items-center gap-1 text-left text-[10px] font-semibold uppercase tracking-wider text-accent-ink disabled:text-ink-faint"
          >
            <NavIcon d="M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" className="h-3 w-3" />
            {t.clientWidgets.restTimer.restSeconds}
          </button>
          <input
            inputMode="numeric"
            value={restInput}
            aria-label={t.clientWidgets.restTimer.restForThisSet}
            onChange={(e) => setRestInput(e.target.value.replace(/[^\d]/g, ""))}
            className={`h-11 w-[4.25rem] rounded-xl border bg-surface px-2.5 text-sm tabular-nums outline-none focus:border-accent ${
              restInput !== String(effectiveRest) ? "border-accent" : "border-line"
            }`}
          />
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="ml-auto flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg disabled:opacity-40"
        >
          {m.logSet}
        </button>
      </div>
      {restPicker && exerciseId ? (
        <RestDurationPicker
          exerciseId={exerciseId}
          exerciseName={name}
          prescribedSeconds={restSeconds}
          prefs={restPrefs}
          onPick={(seconds) => setRestInput(String(seconds))}
          onClose={() => setRestPicker(false)}
        />
      ) : null}

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
          className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
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
        className="h-11 w-[4.25rem] rounded-xl border border-line bg-surface px-2.5 text-sm tabular-nums outline-none focus:border-accent"
      />
    </label>
  );
}
