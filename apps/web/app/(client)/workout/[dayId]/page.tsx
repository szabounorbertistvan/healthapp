import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkoutDay, getWorkoutDayHistory } from "@/lib/client-data";
import { Card, PageTitle } from "@/components/ui";
import { WorkoutHistory } from "@/components/workout-history";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

/**
 * A training day, opened from Training: what it prescribes, a button into the
 * set logger, and every past session of this day with its sets — last time's
 * numbers before this time's attempt. Today's "Start workout" skips this page
 * and goes straight to the logger.
 */
export default async function WorkoutDayPage({
  params,
}: {
  params: Promise<{ dayId: string }>;
}) {
  const { t } = await getI18n();
  const { dayId } = await params;
  const [day, history] = await Promise.all([getWorkoutDay(dayId), getWorkoutDayHistory(dayId)]);
  if (!day) notFound();
  const d = t.clientApp.workoutDay;
  const inProgress = day.logged.length > 0;

  return (
    <div className="space-y-4">
      <Link href="/workout" className="text-xs font-semibold text-ink-faint hover:text-accent-ink">
        {d.backToTraining}
      </Link>
      <PageTitle title={day.day_name}>
        <span className="text-xs text-ink-faint">
          {day.program_name} · {day.intensity_mode.toUpperCase()}
        </span>
      </PageTitle>

      <Card>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {d.exercises} · {fill(t.clientApp.workout.exercisesCount, { count: day.exercises.length })}
        </p>
        <ul className="space-y-1 text-sm text-ink-soft">
          {day.exercises.map((e) => (
            <li key={e.id} className="flex justify-between gap-2">
              <span className="truncate">{e.exercise}</span>
              <span className="shrink-0 tabular-nums text-ink-faint">
                {e.sets}×{e.reps}
                {e.weight_kg ? ` · ${e.weight_kg} kg` : ""}
              </span>
            </li>
          ))}
        </ul>
        <Link
          href={`/workout/${day.day_id}/log`}
          className="mt-4 inline-block w-full rounded-lg bg-accent px-4 py-3 text-center text-sm font-semibold text-accent-fg hover:opacity-90"
        >
          {inProgress ? d.continueWorkout : d.start}
        </Link>
      </Card>

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-bold">{d.history}</h2>
          <span className="text-xs tabular-nums text-ink-faint">
            {history.length === 1 ? d.sessionOne : fill(d.sessionsCount, { count: history.length })}
          </span>
        </div>
        <WorkoutHistory sessions={history} />
      </div>
    </div>
  );
}
