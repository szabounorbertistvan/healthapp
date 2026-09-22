import Link from "next/link";
import { notFound } from "next/navigation";
import { getLastPerformance, getWorkoutDay } from "@/lib/client-data";
import { NavIcon } from "@/components/client-nav";
import { SetLogger } from "@/components/set-logger";
import { getI18n } from "@/lib/i18n/server";

/** The set logger for one training day. Today links here directly. */
export default async function WorkoutLogPage({
  params,
}: {
  params: Promise<{ dayId: string }>;
}) {
  const { t } = await getI18n();
  const { dayId } = await params;
  const day = await getWorkoutDay(dayId);
  if (!day) notFound();
  // What this person lifted here last time, so the boxes open on their numbers
  // rather than on the prescription they have long since outgrown.
  const last = await getLastPerformance(day);

  return (
    <div className="mx-auto max-w-[1600px]">
      <Link
        href={`/workout/${day.day_id}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-accent-ink"
      >
        <NavIcon d="m15 6-6 6 6 6" className="h-3.5 w-3.5" />
        {day.day_name}
      </Link>
      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {day.program_name} · {day.intensity_mode.toUpperCase()}
        </p>
        <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">
          {t.clientApp.workoutDay.logToday}
        </h1>
      </div>
      <div className="mt-5">
        <SetLogger day={day} last={last} />
      </div>
    </div>
  );
}
