import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkoutDay } from "@/lib/client-data";
import { PageTitle } from "@/components/ui";
import { SetLogger } from "@/components/set-logger";

export default async function WorkoutDayPage({
  params,
}: {
  params: Promise<{ dayId: string }>;
}) {
  const { dayId } = await params;
  const day = await getWorkoutDay(dayId);
  if (!day) notFound();

  return (
    <div>
      <Link href="/workout" className="text-xs font-semibold text-ink-faint hover:text-accent-ink">
        ← Training
      </Link>
      <PageTitle title={day.day_name}>
        <span className="text-xs text-ink-faint">
          {day.program_name} · {day.intensity_mode.toUpperCase()}
        </span>
      </PageTitle>
      <SetLogger day={day} />
    </div>
  );
}
