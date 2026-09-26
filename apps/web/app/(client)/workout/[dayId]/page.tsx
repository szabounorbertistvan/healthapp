import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkoutDay, getWorkoutDayHistory, hasActiveCoach } from "@/lib/client-data";
import { getProfile } from "@/lib/data";
import { shareProfileOf } from "@/lib/share-card-data";
import { Card } from "@/components/ui";
import { Athlete } from "@/components/athlete";
import { NavIcon } from "@/components/client-nav";
import { WorkoutHistory } from "@/components/workout-history";
import { DayExerciseRow } from "@/components/day-exercise-row";
import { getExerciseSummaries } from "@/lib/exercise-summaries";
import { TrainingLoadCard } from "@/components/training-load";
import { circuitSegments } from "@healthapp/shared";
import { timeAgo } from "@/lib/format";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { getPlan, inHistory } from "@/lib/plan";
import { UpgradeHint } from "@/components/upgrade";

/**
 * A training day, opened from Training. Two columns once there is room: the
 * plan on the left (header with the day's athlete, the start button, every
 * exercise with its prescription, circuits grouped) and what happened before
 * on the right (the load of the last session, every past session with its
 * sets — last time's numbers before this time's attempt). Today's "Start
 * workout" skips this page and goes straight to the logger.
 */
export default async function WorkoutDayPage({
  params,
}: {
  params: Promise<{ dayId: string }>;
}) {
  const { t, locale } = await getI18n();
  const { dayId } = await params;
  // getProfile is request-cached (the layout already read it) — no extra round trip.
  const [day, allHistory, profile, coached, plan] = await Promise.all([
    getWorkoutDay(dayId),
    getWorkoutDayHistory(dayId),
    getProfile(),
    hasActiveCoach(),
    getPlan(),
  ]);
  if (!day) notFound();
  // Only this day's exercises, for the detail popup each row opens — one small query, not the library.
  const details = await getExerciseSummaries(day.exercises.flatMap((e) => (e.exercise_id ? [e.exercise_id] : [])));
  // A solo client edits their own days in the builder; a coached one edits nothing (can_edit_program).
  const editHref = day.is_own && !coached ? `/workout/build?program=${day.program_id}` : null;
  const d = t.clientApp.workoutDay;
  const inProgress = day.logged.length > 0;
  // Sessions older than the plan's history window wait behind the hint.
  const history = allHistory.filter((s) => inHistory(plan, s.at));
  // History is newest first, so [0] is the last time this day was trained.
  const last = history[0] ?? null;
  const logHref = `/workout/${day.day_id}/log`;
  const scale = day.intensity_mode === "rpe" ? "RPE" : "RIR";

  // A tap opens the exercise's detail popup, the same one the library shows.
  const row = (e: (typeof day.exercises)[number]) => (
    <DayExerciseRow
      key={e.id}
      exercise={e.exercise_id ? details[e.exercise_id] ?? null : null}
      name={e.exercise}
      prescription={`${e.sets}×${e.reps}${e.rpe_value !== null ? ` · ${scale} ${e.rpe_value}` : ""}${e.weight_kg ? ` · ${e.weight_kg} kg` : ""}`}
    />
  );

  return (
    // Capped: this is a page to read, not a grid of cards — on an ultrawide the
    // two columns would otherwise run 1 500 px each.
    <div className="mx-auto max-w-[1600px]">
      <div className="flex items-center justify-between gap-3">
        <Link href="/workout" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-accent-ink">
          <NavIcon d="m15 6-6 6 6 6" className="h-3.5 w-3.5" />
          {t.common.nav.training}
        </Link>
        {editHref ? (
          <Link
            href={editHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-xs font-semibold text-ink-soft hover:text-accent-ink"
          >
            <NavIcon d="M4 20h4l10-10-4-4L4 16zM13 7l4 4" className="h-3.5 w-3.5" />
            {d.editDay}
          </Link>
        ) : null}
      </div>

      <div className="mt-3 grid gap-5 xl:grid-cols-2 xl:items-start xl:gap-8">
        {/* ---- the plan ---- */}
        <div className="space-y-5">
          <Card plain className="relative flex min-h-[200px] overflow-hidden p-0 xl:min-h-[224px]">
            <div className="flex min-w-0 flex-1 flex-col py-5 pl-5 pr-1 xl:p-6 xl:pr-2">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                {day.program_name} · {day.intensity_mode.toUpperCase()}
              </p>
              <h1 className="mt-2 font-display text-[26px] font-extrabold leading-[1.05] tracking-tight xl:text-[32px]">{day.day_name}</h1>
              <p className="mt-2 text-[13px] text-ink-soft">
                {fill(t.clientApp.workout.exercisesCount, { count: day.exercises.length })}
              </p>
              {inProgress ? (
                <div className="mt-auto pt-4">
                  <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-[11px] font-bold text-warn">
                    {t.clientApp.workout.inProgress}
                  </span>
                </div>
              ) : null}
            </div>
            {day.type ? (
              <div className="pointer-events-none relative w-[42%] shrink-0 xl:w-[38%]">
                <Athlete
                  type={day.type}
                  sex={profile?.sex ?? null}
                  seed={day.day_id}
                  priority
                  sizes="(min-width: 1280px) 22rem, 42vw"
                  className="absolute bottom-0 right-3 h-[calc(100%-14px)] w-auto max-w-full object-contain object-right-bottom"
                />
              </div>
            ) : null}
          </Card>

          <Link
            href={logHref}
            className="flex h-[50px] w-full items-center justify-center gap-2.5 rounded-2xl bg-accent px-6 font-display text-[15px] font-bold text-accent-fg hover:opacity-90 xl:inline-flex xl:w-auto"
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 4v16l13-8z" />
            </svg>
            {inProgress ? d.continueWorkout : d.start}
          </Link>

          <section>
            <p className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {d.exercises} · {fill(t.clientApp.workout.exercisesCount, { count: day.exercises.length })}
            </p>
            <div className="space-y-2.5">
              {circuitSegments(day.exercises).map((seg, si) =>
                seg.circuit !== null ? (
                  <div key={seg.circuit} className="space-y-2 rounded-[20px] border-l-[3px] border-accent bg-accent-soft/55 p-2 pl-[9px]">
                    {seg.label ? (
                      <p className="flex items-center gap-1.5 px-2.5 pt-0.5 text-[10.5px] font-bold uppercase tracking-wider text-accent-ink">
                        <NavIcon d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" className="h-[13px] w-[13px]" />
                        {fill(t.coachWidgets.programBuilder.circuitName, { label: seg.label })}
                      </p>
                    ) : null}
                    {seg.exercises.map(row)}
                  </div>
                ) : (
                  <div key={`solo-${si}`} className="space-y-2.5">
                    {seg.exercises.map(row)}
                  </div>
                ),
              )}
            </div>
          </section>
        </div>

        {/* ---- what happened before ---- */}
        <div className="space-y-5">
          {last ? <TrainingLoadCard load={last.load} when={timeAgo(last.at, locale)} /> : null}

          <section>
            <div className="mb-2.5 flex items-baseline justify-between px-1">
              <h2 className="text-sm font-bold">{d.history}</h2>
              <span className="text-xs tabular-nums text-ink-faint">
                {history.length === 1 ? d.sessionOne : fill(d.sessionsCount, { count: history.length })}
              </span>
            </div>
            <WorkoutHistory sessions={history} share={{ dayName: day.day_name, profile: shareProfileOf(profile) }} />
            {history.length < allHistory.length ? (
              <UpgradeHint
                card
                feature="history"
                upgrade={plan.upgrade}
                values={{ days: plan.e.historyDays ?? 0 }}
                className="mt-3"
              />
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
