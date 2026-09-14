"use client";
import { useEffect, useState, useTransition } from "react";
import { exerciseRef, type ExerciseSummary } from "@healthapp/shared";
import { renameExercise, searchExerciseLibrary } from "@/app/library-actions";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";
import { NewExerciseForm } from "./new-exercise-form";

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
  const { t } = useI18n();
  const m = t.coachWidgets.exercisePicker;
  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState(initialMuscle ?? "");
  const [gear, setGear] = useState("");
  const [results, setResults] = useState<ExerciseSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  // Renaming one of the caller's own custom exercises, inline in its row.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  function saveRename(exercise: ExerciseSummary) {
    const id = exercise.id;
    if (!id) return;
    startTransition(async () => {
      setRenameError(null);
      const r = await renameExercise(id, newName);
      if (!r.ok) { setRenameError(r.message ?? m.couldNotRename); return; }
      setResults((current) => current.map((e) => (e.id === id ? { ...e, name_en: newName.trim(), name_ro: newName.trim() } : e)));
      setRenaming(null);
    });
  }

  // Debounced: the coach types faster than a round-trip, and the library is
  // 873 rows on the server rather than in this bundle.
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      startTransition(async () => {
        const found = await searchExerciseLibrary({ q, muscle, equipment: gear });
        setResults(found.results);
        setTotal(found.total);
        setLoading(false);
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [q, muscle, gear]);

  // Next page of the same filter, appended. The server orders by name, so the
  // offset is simply how many rows are already on screen.
  function loadMore() {
    startTransition(async () => {
      const found = await searchExerciseLibrary({ q, muscle, equipment: gear }, results.length);
      setResults((current) => [...current, ...found.results]);
      setTotal(found.total);
    });
  }

  // A freshly created exercise goes to the top of the list and, when the picker
  // is attached to a day, straight into that day — one motion, not two.
  function onCreated(exercise: ExerciseSummary) {
    setCreating(false);
    setResults((current) => [exercise, ...current]);
    setTotal((n) => n + 1);
    setCreated(exercise.name_en);
    onPick?.(exercise);
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={m.searchPlaceholder}
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          aria-expanded={creating}
          className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold ${
            creating ? "border-accent text-accent-ink" : "border-line hover:border-accent"
          }`}
        >
          + {m.createExercise}
        </button>
      </div>

      {creating ? (
        <NewExerciseForm
          muscles={muscles}
          equipment={equipment}
          initialName={q}
          initialMuscle={muscle}
          canAdd={Boolean(onPick)}
          onCreated={onCreated}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {created ? (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs font-semibold text-accent-ink">
          {created} — {t.coachWidgets.newExerciseForm.created}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Facet label={m.allMuscles} options={muscles} value={muscle} onChange={setMuscle} />
        <Facet label={m.allEquipment} options={equipment} value={gear} onChange={setGear} />
        {muscle || gear || q ? (
          <button
            onClick={() => {
              setQ("");
              setMuscle("");
              setGear("");
            }}
            className="rounded-lg px-2 py-1 text-xs text-ink-soft underline"
          >
            {m.clear}
          </button>
        ) : null}
      </div>

      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-ink-faint">
        <span>
          {loading
            ? m.searching
            : fill(total === 1 ? m.exercisesOne : total < 20 ? m.exercisesFew : m.exercisesMany, {
                n: total,
              })}
          {total > results.length ? ` ${fill(m.showingFirst, { n: results.length })}` : ""}
        </span>
        {/* The nudge sits next to the count once something is typed — a
            match may be listed and still not be the one they mean. */}
        {!creating && q.trim() && !loading && results.length > 0 ? (
          <span>
            {m.notFound}{" "}
            <button type="button" onClick={() => setCreating(true)} className="font-semibold text-accent-ink hover:underline">
              {m.createExercise}
            </button>
          </span>
        ) : null}
      </p>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {results.map((exercise) => (
          <li
            key={exerciseRef(exercise)}
            className="rounded-lg border border-line bg-bg p-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {renaming === exerciseRef(exercise) ? (
                  <form
                    className="flex gap-1.5"
                    onSubmit={(e) => { e.preventDefault(); saveRename(exercise); }}
                  >
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      aria-label={m.renameExercise}
                      className="min-w-0 flex-1 rounded border border-accent bg-surface px-2 py-1 text-sm outline-none"
                    />
                    <button type="submit" disabled={pending || newName.trim().length < 2} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg disabled:opacity-40">
                      {t.common.actions.save}
                    </button>
                    <button type="button" onClick={() => setRenaming(null)} className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-faint hover:text-ink">
                      {t.common.actions.cancel}
                    </button>
                  </form>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <span className="min-w-0 truncate">{exercise.name_en}</span>
                    {exercise.mine ? (
                      <>
                        <span className="shrink-0 rounded border border-line px-1 text-[9px] font-semibold uppercase tracking-wider text-ink-faint">{m.mine}</span>
                        <button
                          type="button"
                          onClick={() => { setNewName(exercise.name_en); setRenaming(exerciseRef(exercise)); }}
                          aria-label={m.renameExercise}
                          title={m.renameExercise}
                          className="shrink-0 rounded px-1 text-xs text-ink-faint hover:text-accent-ink"
                        >
                          ✎
                        </button>
                      </>
                    ) : null}
                  </p>
                )}
                {renaming === exerciseRef(exercise) && renameError ? <p className="mt-1 text-xs text-risk">{renameError}</p> : null}
                <p className="mt-0.5 text-xs text-ink-faint">
                  {exercise.primary_muscles.join(", ") || "—"}
                  {exercise.equipment ? ` · ${exercise.equipment}` : ""}
                  {exercise.level ? ` · ${exercise.level}` : ""}
                </p>
              </div>
              {onPick ? (
                <button
                  onClick={() => onPick(exercise)}
                  className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold hover:border-accent hover:text-accent-ink"
                >
                  {pendingLabel ?? t.common.actions.add}
                </button>
              ) : null}
            </div>
          </li>
        ))}
        {!loading && results.length === 0 ? (
          <li className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-soft">
            {m.noMatch}
            {!creating ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mt-2 block w-full rounded-lg border border-line px-3 py-2 text-xs font-semibold hover:border-accent hover:text-accent-ink"
              >
                + {m.createExercise}
              </button>
            ) : null}
          </li>
        ) : null}
        {!loading && total > results.length ? (
          <li>
            <button
              type="button"
              disabled={pending}
              onClick={loadMore}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-soft hover:border-accent hover:text-accent-ink disabled:opacity-40"
            >
              {pending ? m.searching : `${m.loadMore} (${total - results.length})`}
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function Facet({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-line bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

export { exerciseRef };
