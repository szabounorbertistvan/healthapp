import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkoutDay } from "@/lib/client-data";
import { PageTitle } from "@/components/ui";
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

  return (
    <div>
      <Link href={`/workout/${day.day_id}`} className="text-xs font-semibold text-ink-faint hover:text-accent-ink">
        ← {day.day_name}
      </Link>
      <PageTitle title={t.clientApp.workoutDay.logToday}>
        <span className="text-xs text-ink-faint">
          {day.program_name} · {day.intensity_mode.toUpperCase()}
        </span>
      </PageTitle>
      <SetLogger day={day} />
    </div>
  );
}
