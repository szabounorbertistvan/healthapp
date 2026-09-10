"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeProgramDay } from "@/app/builder-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { ClientProgramGroup, ClientWorkoutDay } from "@/lib/types";
import { Card } from "./ui";
import { SwipeToDelete } from "./swipe-to-delete";

/**
 * Training, the list. Every published program the client holds is shown — the
 * coach's and their own — each under its own heading. A day the client built
 * can be swiped away (with confirmation); a coach's day cannot, because it is
 * the coach's to change.
 */
export function WorkoutDayList({ groups }: { groups: ClientProgramGroup[] }) {
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
        <Card className="border-risk bg-risk-soft">
          <p className="text-sm font-semibold text-risk">{error}</p>
        </Card>
      ) : null}

      {groups.map((group) => (
        <section key={group.program_id}>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {group.program_name}
            </p>
            <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint">
              {group.is_own ? w.byYou : w.byCoach}
            </span>
            {group.followed && groups.length > 1 ? (
              <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">
                {w.followed}
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {group.days.map((day) =>
              group.is_own ? (
                <SwipeToDelete
                  key={day.day_id}
                  confirmText={fill(w.deleteDayConfirm, { name: day.day_name })}
                  onDelete={() => remove(day)}
                >
                  <DayCard day={day} />
                </SwipeToDelete>
              ) : (
                <DayCard key={day.day_id} day={day} />
              ),
            )}

            {group.is_own ? (
              <Link
                href="/workout/build"
                className="flex h-full min-h-28 items-center justify-center gap-2 rounded-xl border border-dashed border-line p-4 text-sm font-semibold text-ink-faint transition hover:border-accent hover:text-accent-ink"
              >
                <span aria-hidden className="text-lg leading-none">+</span>
                {w.addAnotherDay}
              </Link>
            ) : null}
          </div>
          {group.is_own && group.days.length > 0 ? (
            <p className="mt-2 text-[11px] text-ink-faint sm:hidden">{w.swipeHint}</p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function DayCard({ day }: { day: ClientWorkoutDay }) {
  const { t } = useI18n();
  return (
    <Link href={`/workout/${day.day_id}`} className="block h-full" draggable={false}>
      <Card className="h-full transition hover:border-accent">
        <div className="flex items-start justify-between gap-2 pr-6">
          <p className="font-bold">{day.day_name}</p>
          {day.logged.length > 0 ? (
            <span className="rounded-md bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
              {t.clientApp.workout.inProgress}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-ink-faint">
          {fill(t.clientApp.workout.exercisesCount, { count: day.exercises.length })}
        </p>
        <ul className="mt-3 space-y-1 text-sm text-ink-soft">
          {day.exercises.map((e) => (
            <li key={e.id} className="flex justify-between gap-2">
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
