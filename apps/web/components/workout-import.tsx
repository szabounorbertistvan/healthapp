"use client";
// The import flow: pick a Hevy / Strong CSV → it is parsed here, in the
// browser (lib/import/workout-csv.ts) → match each exercise name to the
// library or skip it → sent a few days at a time to importWorkoutChunk()
// → PR flags re-derived per lift by finishWorkoutImport().
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WeightUnit } from "@healthapp/shared";
import { finishWorkoutImport, importWorkoutChunk, type ImportChunkSession } from "@/app/import-actions";
import { exerciseNames, MAX_IMPORT_BYTES, parseWorkoutCsv, type ParseResult } from "@/lib/import/workout-csv";
import { buildMatchIndex, matchExercise, type LibraryExercise } from "@/lib/import/exercise-match";
import { BUTTON, FIELD, SMALL_BUTTON, SMALL_BUTTON_INSET } from "@/lib/form-classes";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "@/components/ui";

/** A day's workouts always travel together (the server's same-day rule needs them in one call). */
const SESSIONS_PER_CALL = 20;
const LIFTS_PER_FINISH = 10;

type Parsed = Extract<ParseResult, { ok: true }>;
/** exercise id, "skip", or null while it still needs a decision. */
type Choice = string | "skip" | null;
type Totals = { sessions: number; sets: number; already: number; dayTaken: number; future: number };

export function WorkoutImport({ library, defaultUnit }: { library: LibraryExercise[]; defaultUnit: WeightUnit }) {
  const { t, locale } = useI18n();
  const m = t.clientApp.workoutImport;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [unit, setUnit] = useState<WeightUnit>(defaultUnit);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [suggested, setSuggested] = useState<Record<string, string[]>>({});
  const [phase, setPhase] = useState<"review" | "running" | "records" | "done">("review");
  const [progress, setProgress] = useState(0);
  const [totals, setTotals] = useState<Totals | null>(null);

  const index = useMemo(() => buildMatchIndex(library), [library]);
  const byId = useMemo(() => new Map(library.map((e) => [e.id, e])), [library]);
  const parsed: Parsed | null = useMemo(() => {
    if (csv === null) return null;
    const r = parseWorkoutCsv(csv, { weightUnit: unit });
    return r.ok ? r : null;
  }, [csv, unit]);
  const names = useMemo(() => (parsed ? exerciseNames(parsed.sessions) : []), [parsed]);
  const setCount = parsed?.sessions.reduce((n, s) => n + s.sets.length, 0) ?? 0;
  const unresolved = names.filter((n) => (choices[n.name] ?? null) === null).length;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setTotals(null);
    setPhase("review");
    if (file.size > MAX_IMPORT_BYTES) {
      setError(fill(m.errTooLarge, { mb: Math.round(MAX_IMPORT_BYTES / 1024 / 1024) }));
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      const r = parseWorkoutCsv(text, { weightUnit: unit });
      if (!r.ok) {
        setCsv(null);
        setError(r.error === "empty" ? m.errEmpty : r.error === "unknownFormat" ? m.errUnknown : m.errNoSessions);
        return;
      }
      const next: Record<string, Choice> = {};
      const hints: Record<string, string[]> = {};
      for (const { name } of exerciseNames(r.sessions)) {
        const match = matchExercise(name, index);
        next[name] = match.exerciseId;
        hints[name] = match.suggestions;
      }
      setChoices(next);
      setSuggested(hints);
      setCsv(text);
    } catch {
      setError(m.errRead);
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function run() {
    if (!parsed || unresolved > 0) return;
    setError(null);
    setPhase("running");
    setProgress(0);
    const sessions: ImportChunkSession[] = parsed.sessions
      .map((s) => ({
        title: s.title,
        startLocal: s.startLocal,
        durationMinutes: s.durationMinutes,
        notes: s.notes,
        sets: s.sets.flatMap((x) => {
          const id = choices[x.exercise];
          return id && id !== "skip"
            ? [{ ordinal: x.ordinal, exerciseId: id, weightKg: x.weightKg, reps: x.reps, durationSeconds: x.durationSeconds, rpe: x.rpe, notes: x.notes }]
            : [];
        }),
      }))
      .filter((s) => s.sets.length > 0);

    // Whole days per call, about SESSIONS_PER_CALL workouts each.
    const calls: ImportChunkSession[][] = [];
    let current: ImportChunkSession[] = [];
    sessions.forEach((s, i) => {
      current.push(s);
      const nextDay = sessions[i + 1]?.startLocal.slice(0, 10);
      if (current.length >= SESSIONS_PER_CALL && nextDay !== s.startLocal.slice(0, 10)) {
        calls.push(current);
        current = [];
      }
    });
    if (current.length > 0) calls.push(current);

    const sum: Totals = { sessions: 0, sets: 0, already: 0, dayTaken: 0, future: 0 };
    let done = 0;
    for (const call of calls) {
      const r = await importWorkoutChunk(call);
      if (!r.ok) {
        setError(r.message ?? m.errWrite);
        setTotals(sum);
        setPhase("review");
        return;
      }
      sum.sessions += r.sessions ?? 0;
      sum.sets += r.sets ?? 0;
      sum.already += r.already ?? 0;
      sum.dayTaken += r.dayTaken ?? 0;
      sum.future += r.future ?? 0;
      done += call.length;
      setProgress(done);
    }

    setPhase("records");
    const lifts = [...new Set(sessions.flatMap((s) => s.sets.map((x) => x.exerciseId)))];
    for (let i = 0; i < lifts.length; i += LIFTS_PER_FINISH) {
      const r = await finishWorkoutImport(lifts.slice(i, i + LIFTS_PER_FINISH));
      if (!r.ok) {
        setError(r.message ?? m.errWrite);
        break;
      }
    }
    setTotals(sum);
    setPhase("done");
    router.refresh();
  }

  function reset() {
    setCsv(null);
    setChoices({});
    setTotals(null);
    setError(null);
    setPhase("review");
  }

  const fileButton = (
    <label className={`${BUTTON} cursor-pointer gap-2`}>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={reading || phase === "running" || phase === "records"}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {reading ? m.reading : m.pickFile}
    </label>
  );

  if (phase === "done" && totals) {
    return (
      <Card plain className="sm:p-5">
        <p className="font-display text-lg font-bold tracking-tight">{m.doneTitle}</p>
        <p className="mt-1 text-sm text-ink-soft">{fill(m.doneBody, { sessions: totals.sessions, sets: totals.sets })}</p>
        <ul className="mt-2 space-y-1 text-[13px] text-ink-faint">
          {totals.already > 0 ? <li>{fill(m.doneAlready, { n: totals.already })}</li> : null}
          {totals.dayTaken > 0 ? <li>{fill(m.doneDayTaken, { n: totals.dayTaken })}</li> : null}
          {totals.future > 0 ? <li>{fill(m.doneFuture, { n: totals.future })}</li> : null}
        </ul>
        {error ? <p role="alert" className="mt-3 text-sm text-risk">{error}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/workout" className={BUTTON}>{m.seeHistory}</Link>
          <button type="button" className={SMALL_BUTTON + " h-11"} onClick={reset}>{m.another}</button>
        </div>
      </Card>
    );
  }

  if (!parsed) {
    return (
      <Card plain className="sm:p-5">
        <p className="text-sm text-ink-soft">{m.intro}</p>
        <ul className="mt-3 space-y-1 text-[13px] text-ink-faint">
          <li>{m.howHevy}</li>
          <li>{m.howStrong}</li>
        </ul>
        <div className="mt-4">{fileButton}</div>
        {error ? <p role="alert" className="mt-3 text-sm text-risk">{error}</p> : null}
      </Card>
    );
  }

  const busy = phase === "running" || phase === "records";
  const first = parsed.sessions[0]!.startLocal.slice(0, 10);
  const last = parsed.sessions[parsed.sessions.length - 1]!.startLocal.slice(0, 10);
  // The library's own name, the Romanian one beside it when the page is in Romanian.
  const label = (id: string) => {
    const e = byId.get(id);
    if (!e) return id;
    const en = e.mine ? `${e.name_en} (${m.yours})` : e.name_en;
    return locale === "ro" && e.name_ro ? `${e.name_ro} · ${en}` : en;
  };

  return (
    <div className="space-y-4">
      <Card plain className="sm:p-5">
        <p className="text-sm font-semibold">
          {fill(m.detected, {
            app: parsed.format === "hevy" ? "Hevy" : "Strong",
            sessions: parsed.sessions.length,
            sets: setCount,
            from: first,
            to: last,
          })}
        </p>
        {!parsed.unitFromFile ? (
          <div className="mt-3">
            <p className="text-[13px] text-ink-soft">{m.unitQuestion}</p>
            <div className="mt-2 flex gap-2" role="radiogroup" aria-label={m.unitQuestion}>
              {(["kg", "lb"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  role="radio"
                  aria-checked={unit === u}
                  disabled={busy}
                  onClick={() => setUnit(u)}
                  className={`h-9 rounded-xl px-4 text-[13px] font-semibold ${unit === u ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft"}`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <ul className="mt-3 space-y-1 text-[13px] text-ink-faint">
          {parsed.skipped.warmups > 0 ? <li>{fill(m.skippedWarmups, { n: parsed.skipped.warmups })}</li> : null}
          {parsed.skipped.cardio > 0 ? <li>{fill(m.skippedCardio, { n: parsed.skipped.cardio })}</li> : null}
          {parsed.skipped.invalid > 0 ? <li>{fill(m.skippedInvalid, { n: parsed.skipped.invalid })}</li> : null}
        </ul>
      </Card>

      <Card plain className="sm:p-5">
        <h2 className="font-display text-lg font-bold tracking-tight">{m.reviewTitle}</h2>
        <p className="mt-1 text-[13px] text-ink-soft">{m.reviewHint}</p>
        <ul className="mt-4 divide-y divide-line">
          {names.map(({ name, sets }) => (
            <ExerciseRow
              key={name}
              name={name}
              sets={sets}
              choice={choices[name] ?? null}
              suggestions={suggested[name] ?? []}
              library={library}
              label={label}
              disabled={busy}
              onChoose={(c) => setChoices((prev) => ({ ...prev, [name]: c }))}
            />
          ))}
        </ul>
      </Card>

      <Card plain className="sm:p-5">
        <h2 className="text-sm font-bold">{m.rulesTitle}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{m.rulesBody}</p>
        {error ? <p role="alert" className="mt-3 text-sm text-risk">{error}</p> : null}
        {totals && error ? (
          <p className="mt-1 text-[13px] text-ink-faint">{fill(m.doneBody, { sessions: totals.sessions, sets: totals.sets })}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={BUTTON} disabled={busy || unresolved > 0} onClick={() => void run()}>
            {phase === "running"
              ? fill(m.importing, { done: progress, total: parsed.sessions.length })
              : phase === "records"
                ? m.updatingRecords
                : fill(m.start, { n: parsed.sessions.length })}
          </button>
          {!busy ? fileButton : null}
          {unresolved > 0 ? <p className="text-[13px] text-warn">{fill(m.unresolved, { n: unresolved })}</p> : null}
        </div>
      </Card>
    </div>
  );
}

function ExerciseRow({
  name, sets, choice, suggestions, library, label, disabled, onChoose,
}: {
  name: string;
  sets: number;
  choice: Choice;
  suggestions: string[];
  library: LibraryExercise[];
  label: (id: string) => string;
  disabled: boolean;
  onChoose: (c: Choice) => void;
}) {
  const { t } = useI18n();
  const m = t.clientApp.workoutImport;
  const [open, setOpen] = useState(choice === null);
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return library
      .filter((e) => {
        const hay = `${e.name_en} ${e.name_ro ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8)
      .map((e) => e.id);
  }, [query, library]);
  const shown = query.trim() ? results : suggestions;
  const status = choice === "skip" ? m.skippedLabel : choice ? m.matched : m.needsMatch;
  const pick = (c: Choice) => {
    onChoose(c);
    setOpen(false);
    setQuery("");
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="text-[12.5px] text-ink-faint">
            {fill(m.sets, { n: sets })} ·{" "}
            <span className={choice === null ? "text-warn" : choice === "skip" ? "" : "text-accent-ink"}>{status}</span>
            {choice && choice !== "skip" ? <> → {label(choice)}</> : null}
          </p>
        </div>
        {!open ? (
          <button type="button" className={SMALL_BUTTON} disabled={disabled} onClick={() => setOpen(true)}>
            {m.change}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 rounded-2xl bg-bg p-3">
          <input
            type="search"
            className={FIELD.replace("bg-bg", "bg-surface") + " mt-0"}
            placeholder={m.search}
            aria-label={`${m.search}: ${name}`}
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!query.trim() && shown.length > 0 ? <p className="mt-2 text-[12px] font-semibold text-ink-faint">{m.suggestions}</p> : null}
          {query.trim() && shown.length === 0 ? <p className="mt-2 text-[13px] text-ink-faint">{m.noResults}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {shown.map((id) => (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => pick(id)}
                className={`${SMALL_BUTTON_INSET} h-auto min-h-9 py-1.5 text-left ${choice === id ? "ring-2 ring-accent" : ""}`}
              >
                {label(id)}
              </button>
            ))}
            <button type="button" disabled={disabled} onClick={() => pick("skip")} className={`${SMALL_BUTTON_INSET} text-ink-soft`}>
              {m.skip}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
