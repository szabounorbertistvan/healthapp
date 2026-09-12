import Link from "next/link";
import { redirect } from "next/navigation";
import { getShareableSession } from "@/lib/social-data";
import { PageTitle } from "@/components/ui";
import { WorkoutDoneShare } from "@/components/workout-done-share";
import { getI18n } from "@/lib/i18n/server";

/**
 * "Workout completed!" — the aggregates of the session just finished and the
 * choice to share them (and any PR) to the feed. Nothing is published unless
 * the client taps Share; without a session id there is nothing to show.
 */
export default async function WorkoutDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ dayId: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { t } = await getI18n();
  const [{ dayId }, { session }] = await Promise.all([params, searchParams]);
  const shareable = session ? await getShareableSession(session) : null;
  if (!shareable) redirect("/today");
  const s = t.common.social;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle title={s.workoutCompleted} />
      <WorkoutDoneShare session={shareable} />
      <div className="flex flex-wrap gap-3">
        <Link href="/today" className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg">
          {s.skipToToday}
        </Link>
        <Link href={`/workout/${dayId}`} className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent">
          {t.clientApp.workoutDay.backToTraining}
        </Link>
      </div>
    </div>
  );
}
