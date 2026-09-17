"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeProgramDay } from "@/app/builder-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { ClientProgramGroup, ClientWorkoutDay, Sex } from "@/lib/types";
import { Card } from "./ui";
import { SwipeToDelete } from "./swipe-to-delete";
import { Athlete } from "./athlete";

/**
 * Training, the list. Every published program the client holds is shown — the
 * coach's and their own — each under its own heading. A day the client built
 * can be swiped away (with confirmation); a coach's day cannot, because it is
 * the coach's to change.
 */
/** `editable` is false for a coached client: their own old programs stay listed but cannot be changed (can_edit_program). */
/** `sex` picks the athlete on each card (users.sex; null → stable pick per day). */
export function WorkoutDayList({ groups, sex, editable = true }: { groups: ClientProgramGroup[]; sex: Sex | null; editable?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const w = t.clientApp.workout;

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
    <div className="space-y-6">
      {error ? (
        <Card plain className="bg-risk-soft">
          <p className="text-sm font-semibold text-risk">{error}</p>
        </Card>
      ) : null}

      {groups.map((group) => (
        <section key={group.program_id}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-ink-soft">{group.program_name}</p>
            <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-faint">
              {group.is_own ? w.byYou : w.byCoach}
            </span>
            {group.followed && groups.length > 1 ? (
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent-ink">
                {w.followed}
              </span>
            ) : null}
          </div>

          {/* As many columns as fit, never a card under 380px — one on a phone,
              two around a laptop, six across an ultrawide. */}
          <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(380px,1fr))] sm:gap-4">
            {group.days.map((day) =>
              group.is_own && editable ? (
                <SwipeToDelete
                  key={day.day_id}
                  className="rounded-3xl"
                  confirmText={fill(w.deleteDayConfirm, { name: day.day_name })}
                  onDelete={() => remove(day)}
                >
                  <DayCard day={day} sex={sex} />
                </SwipeToDelete>
              ) : (
                <DayCard key={day.day_id} day={day} sex={sex} />
              ),
            )}

            {group.is_own && editable ? (
              <Link
                href="/workout/build"
                className="flex min-h-20 items-center justify-center gap-2 rounded-3xl border border-dashed border-line p-4 text-sm font-semibold text-ink-faint transition hover:border-accent hover:text-accent-ink sm:min-h-[150px]"
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
      ))}
    </div>
  );
}

/**
 * One day: a header row — the athlete for what the day trains in a square
 * tile on the page background, the name and exercise count, the chevron —
 * then every exercise with its sets × reps on the card's full width. The
 * tile is a fixed size, so the figure looks the same whether the day has
 * three exercises or nine, and names no longer truncate against it.
 */
function DayCard({ day, sex }: { day: ClientWorkoutDay; sex: Sex | null }) {
  const { t } = useI18n();
  const w = t.clientApp.workout;
  return (
    <Link href={`/workout/${day.day_id}`} className="block h-full" draggable={false}>
      <Card plain className="flex h-full flex-col p-3.5 transition hover:bg-accent-soft/40 sm:p-4">
        <div className="flex items-center gap-3.5">
          {day.type ? (
            <div className="relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-2xl bg-bg sm:h-[92px] sm:w-[92px]">
              <Athlete
                type={day.type}
                sex={sex}
                seed={day.day_id}
                sizes="92px"
                className="absolute inset-x-1.5 bottom-0 h-[calc(100%-6px)] w-[calc(100%-12px)] object-contain object-bottom"
              />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            {day.logged.length > 0 ? (
              <span className="mb-1.5 inline-block rounded-full bg-warn-soft px-2.5 py-0.5 text-[11px] font-bold text-warn">
                {w.inProgress}
              </span>
            ) : null}
            <h3 className="truncate font-display text-xl font-bold leading-tight tracking-tight">{day.day_name}</h3>
            <p className="mt-1 text-[12.5px] text-ink-faint">{fill(w.exercisesCount, { count: day.exercises.length })}</p>
          </div>
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </span>
        </div>
        <ul className="mt-3 space-y-0.5 px-1.5 text-[13.5px] text-ink-soft">
          {day.exercises.map((e) => (
            <li key={e.id} className="flex justify-between gap-3">
              <span className="truncate">{e.exercise}</span>
              <span className="shrink-0 tabular-nums text-ink-faint">
                {e.sets}×{e.reps}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Link>
  );
}
