"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { estimateDayMinutes } from "@healthapp/shared";
import { removeProgramDay } from "@/app/builder-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { timeAgo } from "@/lib/format";
import { EXERCISE_TYPES, type ExerciseType } from "@/lib/exercise-types";
import type { ClientProgramGroup, ClientWorkoutDay, SessionSummaryRow } from "@/lib/types";
import { Card } from "./ui";
import { SwipeToDelete } from "./swipe-to-delete";
import { Athlete } from "./athlete";

/**
 * Training, the list. Every published program the client holds is shown — the
 * coach's and their own — each under its own heading. A day the client built
 * can be swiped away (with confirmation); a coach's day cannot, because it is
 * the coach's to change.
 *
 * Above the groups: a search box and one chip per exercise type present, both
 * filtering in memory (a program is a handful of days — no round trip).
 * `sessions` (recent completed ones) tells each card when it was last done.
 */
/** `editable` is false for a coached client: their own old programs stay listed but cannot be changed (can_edit_program). */
export function WorkoutDayList({
  groups, sessions = [], editable = true,
}: { groups: ClientProgramGroup[]; sessions?: SessionSummaryRow[]; editable?: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ExerciseType | null>(null);
  const w = t.clientApp.workout;

  // Chips only for the types the client's days actually cover, in canonical order.
  const types = useMemo(() => {
    const present = new Set(groups.flatMap((g) => g.days.map((d) => d.type)).filter(Boolean));
    return EXERCISE_TYPES.filter((x) => present.has(x));
  }, [groups]);

  // Newest completed session per day, for the "done …" pill.
  const lastByDay = useMemo(() => {
    const map = new Map<string, SessionSummaryRow>();
    for (const s of sessions) if (s.day_id && !map.has(s.day_id)) map.set(s.day_id, s);
    return map;
  }, [sessions]);

  const q = query.trim().toLowerCase();
  const matches = (day: ClientWorkoutDay) =>
    (type === null || day.type === type) &&
    (q === "" || day.day_name.toLowerCase().includes(q) || day.exercises.some((e) => e.exercise.toLowerCase().includes(q)));

  function remove(day: ClientWorkoutDay) {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        setError(null);
        const result = await removeProgramDay(day.program_id, day.day_id);
        if (!result.ok) setError(result.message ?? w.couldNotDelete);
        router.refresh();
        resolve();
      });
    });
  }

  return (
    <div className="space-y-5">
      {error ? (
        <Card className="border-risk bg-risk-soft">
          <p className="text-sm font-semibold text-risk">{error}</p>
        </Card>
      ) : null}

      <label className="flex h-12 items-center gap-3 rounded-2xl bg-surface px-4 text-sm text-ink-faint">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={w.searchPlaceholder}
          aria-label={w.searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
        />
      </label>

      {types.length > 1 ? (
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none]">
          <Chip on={type === null} onClick={() => setType(null)}>{w.filterAll}</Chip>
          {types.map((x) => (
            <Chip key={x} on={type === x} onClick={() => setType(type === x ? null : x)}>{w.types[x]}</Chip>
          ))}
        </div>
      ) : null}

      {groups.map((group) => {
        const days = group.days.filter(matches);
        if (days.length === 0 && (q !== "" || type !== null)) return null;
        return (
          <section key={group.program_id}>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                {group.program_name}
              </p>
              <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint">
                {group.is_own ? w.byYou : w.byCoach}
              </span>
              {group.followed && groups.length > 1 ? (
                <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">
                  {w.followed}
                </span>
              ) : null}
            </div>

            <div className="grid gap-3">
              {days.map((day) => {
                const last = lastByDay.get(day.day_id) ?? null;
                const card = <DayCard day={day} last={last ? { when: timeAgo(last.at, locale), prs: last.prs } : null} />;
                return group.is_own && editable ? (
                  <SwipeToDelete
                    key={day.day_id}
                    className="rounded-3xl"
                    confirmText={fill(w.deleteDayConfirm, { name: day.day_name })}
                    onDelete={() => remove(day)}
                  >
                    {card}
                  </SwipeToDelete>
                ) : (
                  <div key={day.day_id}>{card}</div>
                );
              })}

              {group.is_own && editable ? (
                <Link
                  href="/workout/build"
                  className="flex min-h-20 items-center justify-center gap-2 rounded-3xl border border-dashed border-line p-4 text-sm font-semibold text-ink-faint transition hover:border-accent hover:text-accent-ink"
                >
                  <span aria-hidden className="text-lg leading-none">+</span>
                  {w.addAnotherDay}
                </Link>
              ) : null}
            </div>
            {group.is_own && editable && group.days.length > 0 ? (
              <p className="mt-2 text-[11px] text-ink-faint sm:hidden">{w.swipeHint}</p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`h-9 shrink-0 rounded-full px-4 text-xs font-semibold transition ${
        on ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * One day: name, state pill (in progress / done today / last done · PRs),
 * exercise count, estimated length and intensity scale, the first exercises,
 * and the athlete for what the day trains standing on the card's right —
 * a full-length cutout, feet on the bottom edge.
 */
function DayCard({ day, last }: { day: ClientWorkoutDay; last: { when: string; prs: number } | null }) {
  const { t } = useI18n();
  const w = t.clientApp.workout;
  const minutes = estimateDayMinutes(day.exercises);
  const shown = day.exercises.slice(0, 2);
  const more = day.exercises.length - shown.length;

  const pill = day.completed
    ? { text: w.doneToday, ok: true }
    : day.logged.length > 0
      ? { text: w.inProgress, ok: false }
      : last
        ? { text: `${fill(w.lastDone, { when: last.when })}${last.prs > 0 ? ` · ${last.prs} ${t.clientApp.workoutDay.prs}` : ""}`, ok: true }
        : null;

  return (
    <Link href={`/workout/${day.day_id}`} className="block" draggable={false}>
      <Card plain className="relative flex min-h-44 gap-2 overflow-hidden p-0 transition hover:bg-accent-soft/40">
        <div className="flex min-w-0 flex-1 flex-col p-5">
          {pill ? (
            <span className={`mb-2 w-fit rounded-full px-2.5 py-0.5 text-[11px] font-bold ${pill.ok ? "bg-accent-soft text-accent-ink" : "bg-warn-soft text-warn"}`}>
              {pill.text}
            </span>
          ) : null}
          <h3 className="font-display text-xl font-bold leading-tight tracking-tight">{day.day_name}</h3>
          <p className="mt-1 text-xs text-ink-faint">
            {fill(w.exercisesCount, { count: day.exercises.length })} · {fill(w.estMinutes, { n: minutes })} · {day.intensity_mode.toUpperCase()}
          </p>
          <ul className="mt-3 space-y-0.5 text-sm text-ink-soft">
            {shown.map((e) => (
              <li key={e.id} className="truncate">
                {e.exercise} <span className="tabular-nums text-ink-faint">{e.sets}×{e.reps}</span>
              </li>
            ))}
            {more > 0 ? <li className="text-xs text-ink-faint">{fill(w.moreExercises, { count: more })}</li> : null}
          </ul>
          <span className="mt-4 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-accent-soft text-accent-ink" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          </span>
        </div>
        {day.type ? (
          <div className="pointer-events-none flex w-[44%] shrink-0 items-end justify-end pr-3 pt-3">
            <Athlete name={day.type} sizes="(min-width: 640px) 18rem, 44vw" className="max-h-44 w-auto max-w-full object-contain object-right-bottom" />
          </div>
        ) : null}
      </Card>
    </Link>
  );
}
