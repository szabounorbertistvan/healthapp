"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { exerciseRef, type ExerciseSummary } from "@healthapp/shared";
import { renameExercise, searchExerciseLibrary } from "@/app/library-actions";
import { useI18n } from "@/lib/i18n/client";
import { exerciseImage, exerciseImages } from "@/lib/exercise-images";
import { fill } from "@/lib/i18n";
import { NewExerciseForm } from "./new-exercise-form";

/** Matches EXERCISE_PAGE_SIZE in app/library-actions.ts. */
const PAGE_SIZE = 40;

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
  // The library is browsed a page at a time rather than appended to: on a phone
  // a list that keeps growing loses your place, and "40 of 873" is the thing
  // you actually want to know. The list box scrolls back to the top on a turn.
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLUListElement>(null);
  const [total, setTotal] = useState(0);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  // The exercise whose photos are open. Both frames exist for every imported
  // row (start and finish of the movement), so a tap on the thumbnail is worth
  // a look at the pair.
  const [preview, setPreview] = useState<ExerciseSummary | null>(null);
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
    setPage(1);
  }, [q, muscle, gear]);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      startTransition(async () => {
        const found = await searchExerciseLibrary({ q, muscle, equipment: gear }, (page - 1) * PAGE_SIZE);
        setResults(found.results);
        setTotal(found.total);
        setLoading(false);
        listRef.current?.scrollTo({ top: 0 });
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [q, muscle, gear, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(total, (page - 1) * PAGE_SIZE + results.length);

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
      {/* Wraps rather than squeezing: "Creează exercițiu" is a long label next
          to a search field on a 390px phone. */}
      <div className="flex flex-wrap gap-2">
        <label className="flex h-[42px] min-w-[11rem] flex-1 items-center gap-2.5 rounded-2xl bg-bg px-3.5 text-ink-faint">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={m.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          aria-expanded={creating}
          className={`inline-flex h-[42px] shrink-0 items-center gap-1.5 rounded-2xl px-3.5 text-[12.5px] font-semibold ${
            creating ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-soft hover:text-ink"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          {m.createExercise}
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
        <p className="rounded-2xl bg-accent-soft px-3.5 py-2.5 text-[12.5px] font-semibold text-accent-ink">
          {created} — {t.coachWidgets.newExerciseForm.created}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Facet label={m.allMuscles} options={muscles} value={muscle} onChange={setMuscle} />
        <Facet label={m.allEquipment} options={equipment} value={gear} onChange={setGear} />
        {muscle || gear || q ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setMuscle("");
              setGear("");
            }}
            className="inline-flex h-9 items-center rounded-full px-3 text-[12.5px] font-semibold text-ink-faint hover:text-ink"
          >
            {m.clear}
          </button>
        ) : null}
      </div>

      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12.5px] text-ink-faint">
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

      {/* As many columns as fit, never a card under 300px: one on a phone and
          inside the day editor's narrow box, several across a wide library. */}
      <ul ref={listRef} className="grid min-h-0 flex-1 auto-rows-min content-start gap-2 overflow-y-auto sm:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
        {results.map((exercise) => (
          <li
            key={exerciseRef(exercise)}
            className="rounded-2xl border border-line/60 bg-bg p-3"
          >
            <div className="flex items-start gap-3">
              <Thumb exercise={exercise} onOpen={() => setPreview(exercise)} />
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
                      className="min-w-0 flex-1 rounded-xl border border-accent bg-surface px-2.5 py-1.5 text-sm outline-none"
                    />
                    <button type="submit" disabled={pending || newName.trim().length < 2} className="rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-accent-fg disabled:opacity-40">
                      {t.common.actions.save}
                    </button>
                    <button type="button" onClick={() => setRenaming(null)} className="rounded-full px-2.5 py-1.5 text-xs font-semibold text-ink-faint hover:text-ink">
                      {t.common.actions.cancel}
                    </button>
                  </form>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <span className="min-w-0 truncate">{exercise.name_en}</span>
                    {exercise.mine ? (
                      <>
                        <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-ink">{m.mine}</span>
                        <button
                          type="button"
                          onClick={() => { setNewName(exercise.name_en); setRenaming(exerciseRef(exercise)); }}
                          aria-label={m.renameExercise}
                          title={m.renameExercise}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-faint hover:text-accent-ink"
                        >
                          <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M4 20h4l10-10-4-4L4 16zM13 7l4 4" />
                          </svg>
                        </button>
                      </>
                    ) : null}
                  </p>
                )}
                {renaming === exerciseRef(exercise) && renameError ? <p className="mt-1 text-xs text-risk">{renameError}</p> : null}
                <p className="mt-1 text-[12.5px] text-ink-faint">
                  {exercise.primary_muscles.join(", ") || "—"}
                  {exercise.equipment ? ` · ${exercise.equipment}` : ""}
                  {exercise.level ? ` · ${exercise.level}` : ""}
                </p>
              </div>
              {onPick ? (
                <button
                  type="button"
                  onClick={() => onPick(exercise)}
                  className="ml-auto inline-flex h-8 shrink-0 items-center rounded-full bg-accent-soft px-3.5 text-xs font-bold text-accent-ink hover:opacity-90"
                >
                  {pendingLabel ?? t.common.actions.add}
                </button>
              ) : null}
            </div>
          </li>
        ))}
        {!loading && results.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-line p-5 text-center text-sm text-ink-soft sm:col-span-full">
            {m.noMatch}
            {!creating ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mx-auto mt-3 flex h-10 items-center gap-1.5 rounded-full bg-bg px-4 text-[12.5px] font-semibold text-ink-soft hover:text-accent-ink"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {m.createExercise}
              </button>
            ) : null}
          </li>
        ) : null}
      </ul>

      {/* Pager: the same shape as the admin desks, so a long list always says
          where you are. Hidden while a single page holds everything. */}
      {!loading && pages > 1 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] tabular-nums text-ink-faint">
            {fill(m.showingRange, { first, last, total })}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || pending}
              onClick={() => setPage((n) => Math.max(1, n - 1))}
              aria-label={m.previousPage}
              title={m.previousPage}
              className="grid h-10 w-10 place-items-center rounded-full bg-bg text-ink-soft hover:text-ink disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m15 6-6 6 6 6" />
              </svg>
            </button>
            <span className="text-[12.5px] font-semibold tabular-nums text-ink-soft">
              {fill(m.pageOfPages, { page, pages })}
            </span>
            <button
              type="button"
              disabled={page >= pages || pending}
              onClick={() => setPage((n) => Math.min(pages, n + 1))}
              aria-label={m.nextPage}
              title={m.nextPage}
              className="grid h-10 w-10 place-items-center rounded-full bg-bg text-ink-soft hover:text-ink disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}

      {preview ? (
        <ExercisePreview
          exercise={preview}
          onClose={() => setPreview(null)}
          onPick={onPick ? () => onPick(preview) : undefined}
          pickLabel={pendingLabel ?? t.common.actions.add}
        />
      ) : null}
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
  // A pill, not a bordered box — same shape as the filters on the client's
  // Training page; gold once it actually filters something.
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 max-w-[60%] cursor-pointer appearance-none truncate rounded-full px-3.5 text-[12.5px] font-semibold outline-none ${
        value ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-soft hover:text-ink"
      }`}
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

/**
 * The exercise's first photo, from the Free Exercise DB import
 * (`exercises.images`, public domain). A plain <img>, not next/image: these are
 * 56px thumbnails of ~1 750 remote files, there is nothing to gain from
 * optimising them on the server, and the host changes the moment
 * `scripts/mirror-exercise-images.mjs` moves them into Supabase Storage.
 * A custom exercise has no photo, so it keeps the dumbbell placeholder.
 */
function Thumb({ exercise, onOpen }: { exercise: ExerciseSummary; onOpen: () => void }) {
  const first = exercise.images?.[0];
  const src = first ? exerciseImage(first) : undefined;
  if (!src) {
    return (
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-surface text-ink-faint" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8" />
        </svg>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={exercise.name_en}
      aria-label={exercise.name_en}
      className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface transition hover:opacity-80"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" aria-hidden loading="lazy" decoding="async" width={56} height={56} className="h-full w-full object-cover" />
    </button>
  );
}

/**
 * One exercise, full size: both frames of the movement side by side (the
 * import stores exactly two, start and finish), what it trains, and the
 * instructions that came with the row. A native <dialog>, so Escape and the
 * backdrop close it — same treatment as the sign-in modal.
 */
function ExercisePreview({
  exercise,
  onClose,
  onPick,
  pickLabel,
}: {
  exercise: ExerciseSummary;
  onClose: () => void;
  onPick?: () => void;
  pickLabel: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  // Open once, on mount. No cleanup that closes it: close() fires the dialog's
  // own close event, which is wired to onClose — in React's development double
  // invoke that tore the dialog down the instant it opened. Unmounting removes
  // the element, which is all the closing it needs.
  useEffect(() => {
    ref.current?.showModal?.();
  }, []);

  const steps = exercise.instructions_en
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const facts = [
    exercise.primary_muscles.join(", "),
    exercise.equipment,
    exercise.level,
    exercise.mechanic,
  ].filter((x): x is string => Boolean(x));

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
      // Tailwind's preflight zeroes the UA `margin: auto` that centres a modal dialog.
      className="app-dialog m-auto max-h-[90vh] w-[min(44rem,92vw)] overflow-y-auto rounded-3xl bg-surface p-0 text-ink backdrop:bg-bg/70"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold tracking-tight">{exercise.name_en}</h2>
          {facts.length > 0 ? <p className="mt-1 text-[12.5px] text-ink-faint">{facts.join(" · ")}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label={t.common.actions.close}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg text-ink-soft hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      {exercise.images.length > 0 ? (
        <div className="mt-4 grid gap-2 px-5 sm:grid-cols-2 sm:px-6">
          {exerciseImages(exercise.images).map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="w-full rounded-2xl bg-bg object-cover"
            />
          ))}
        </div>
      ) : null}

      {steps.length > 0 ? (
        <ol className="mt-4 space-y-2 px-5 text-[13.5px] leading-relaxed text-ink-soft sm:px-6">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-bold tabular-nums text-accent-ink">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="mt-5 flex justify-end gap-2 px-5 pb-5 sm:px-6 sm:pb-6">
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="inline-flex h-11 items-center rounded-full bg-bg px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          {t.common.actions.close}
        </button>
        {onPick ? (
          <button
            type="button"
            onClick={() => {
              onPick();
              ref.current?.close();
            }}
            className="inline-flex h-11 items-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
          >
            {pickLabel}
          </button>
        ) : null}
      </div>
    </dialog>
  );
}
