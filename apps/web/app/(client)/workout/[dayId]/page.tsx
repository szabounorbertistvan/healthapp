import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkoutDay, getWorkoutDayHistory } from "@/lib/client-data";
import { getProfile } from "@/lib/data";
import { shareProfileOf } from "@/lib/share-card-data";
import { Card } from "@/components/ui";
import { Athlete } from "@/components/athlete";
import { WorkoutHistory } from "@/components/workout-history";
import { TrainingLoadCard } from "@/components/training-load";
import { circuitSegments, estimateDayMinutes } from "@healthapp/shared";
import { timeAgo } from "@/lib/format";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

/**
 * A training day, opened from Training: a photo header for what the day
 * trains, three key numbers, what it prescribes (with a thumbnail per
 * exercise and circuits grouped), a button into the set logger, the load of
 * the last session, and every past session with its sets — last time's numbers
 * before this time's attempt. Today's "Start workout" skips this page and goes
 * straight to the logger.
 */
export default async function WorkoutDayPage({
  params,
}: {
  params: Promise<{ dayId: string }>;
}) {
  const { t, locale } = await getI18n();
  const { dayId } = await params;
  // getProfile is request-cached (the layout already read it) — no extra round trip.
  const [day, history, profile] = await Promise.all([getWorkoutDay(dayId), getWorkoutDayHistory(dayId), getProfile()]);
  if (!day) notFound();
  const d = t.clientApp.workoutDay;
  const inProgress = day.logged.length > 0;
  // History is newest first, so [0] is the last time this day was trained.
  const last = history[0] ?? null;
  const logHref = `/workout/${day.day_id}/log`;
  const totalSets = day.exercises.reduce((sum, e) => sum + e.sets, 0);
  const scale = day.intensity_mode === "rpe" ? "RPE" : d.rir;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Link href="/workout" className="text-xs font-semibold text-ink-faint hover:text-accent-ink">
        {d.backToTraining}
      </Link>

      {/* Photo header: the studio shot for the day's type, name over a shade, start button. */}
      <div className="relative h-56 overflow-hidden rounded-3xl bg-surface sm:h-64">
        {day.type ? (
          <Image
            src={`/brand/athletes/hero/${day.type}.webp`}
            alt=""
            aria-hidden
            fill
            priority
            sizes="(min-width: 640px) 42rem, 100vw"
            className="object-cover object-right"
          />
        ) : null}
        <div className="absolute inset-0 bg-linear-to-t from-bg/90 via-bg/35 to-transparent" aria-hidden />
        <div className="absolute inset-x-5 bottom-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{day.day_name}</h1>
            <p className="mt-1 truncate text-xs text-ink-soft">
              {day.program_name} · {day.intensity_mode.toUpperCase()}
            </p>
          </div>
          <Link
            href={logHref}
            aria-label={inProgress ? d.continueWorkout : d.start}
            className="grid h-13 w-13 shrink-0 place-items-center rounded-full bg-accent text-accent-fg shadow-[0_8px_24px_rgba(0,0,0,.35)] hover:opacity-90"
          >
            <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-current" aria-hidden><path d="M7 4v16l13-8z" /></svg>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 tabular-nums">
        <Stat label={d.duration} value={fill(t.clientApp.workout.estMinutes, { n: estimateDayMinutes(day.exercises) })} />
        <Stat label={d.totalSets} value={String(totalSets)} />
        <Stat label={d.intensityLabel} value={day.intensity_mode === "simple" ? "—" : scale} />
      </div>

      <div>
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {d.exercises} · {fill(t.clientApp.workout.exercisesCount, { count: day.exercises.length })}
        </p>
        <div className="space-y-2">
          {circuitSegments(day.exercises).map((seg, si) => (
            <div key={seg.circuit ?? `solo-${si}`} className={seg.circuit !== null ? "space-y-2 rounded-3xl border-l-[3px] border-accent bg-accent-soft/30 py-2 pl-2" : "space-y-2"}>
              {seg.label ? (
                <p className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wider text-accent-ink">
                  🔗 {fill(t.coachWidgets.programBuilder.circuitName, { label: seg.label })}
                </p>
              ) : null}
              {seg.exercises.map((e) => (
                <Card plain key={e.id} className="flex items-center gap-3 p-2.5 pr-4">
                  <span className="grid h-13 w-13 shrink-0 place-items-center overflow-hidden rounded-2xl bg-bg">
                    {e.type ? <Athlete name={e.type} sizes="44px" className="h-11 w-11 object-contain object-bottom" /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{e.exercise}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-ink-faint">
                      {e.sets} × {e.reps}
                      {e.rpe_value !== null ? ` · ${scale} ${e.rpe_value}` : ""}
                      {e.weight_kg ? ` · ${e.weight_kg} kg` : ""}
                      {e.rest_seconds ? ` · ${d.rest} ${e.rest_seconds} s` : ""}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          ))}
        </div>
      </div>

      <Link
        href={logHref}
        className="block w-full rounded-2xl bg-accent px-4 py-3.5 text-center font-display text-sm font-bold text-accent-fg hover:opacity-90"
      >
        {inProgress ? d.continueWorkout : d.start}
      </Link>

      {last ? <TrainingLoadCard load={last.load} when={timeAgo(last.at, locale)} /> : null}

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-bold">{d.history}</h2>
          <span className="text-xs tabular-nums text-ink-faint">
            {history.length === 1 ? d.sessionOne : fill(d.sessionsCount, { count: history.length })}
          </span>
        </div>
        <WorkoutHistory sessions={history} share={{ dayName: day.day_name, profile: shareProfileOf(profile) }} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card plain className="px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 font-display text-lg font-bold">{value}</p>
    </Card>
  );
}
