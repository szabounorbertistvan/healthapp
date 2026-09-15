import Link from "next/link";
import { redirect } from "next/navigation";
import { getShareableSession } from "@/lib/social-data";
import { getMyStreak } from "@/lib/streak-data";
import { getProfile } from "@/lib/data";
import { shareCardFromSession } from "@/lib/share-card";
import { shareProfileOf } from "@/lib/share-card-data";
import { PageTitle } from "@/components/ui";
import { WorkoutDoneShare } from "@/components/workout-done-share";
import { ShareWorkoutButton } from "@/components/share-workout";
import { StreakAfterWorkout } from "@/components/streak";
import { getI18n } from "@/lib/i18n/server";

/**
 * "Workout completed!" — the aggregates of the session just finished and the
 * choice to share them (and any PR) to the feed, with what the session did
 * to the streak on top. Nothing is published unless
 * the client taps Share; without a session id there is nothing to show.
 * "Share Workout" builds the external card (Instagram Stories etc.) from this
 * same session — the id in the URL, never "the latest one".
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
  const [shareable, streak, profile] = await Promise.all([
    session ? getShareableSession(session) : null, getMyStreak(), getProfile(),
  ]);
  if (!shareable) redirect("/today");
  const s = t.common.social;
  const card = shareCardFromSession(shareable, shareProfileOf(profile));

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle title={s.workoutCompleted} />
      {streak ? <StreakAfterWorkout view={streak} /> : null}
      <WorkoutDoneShare session={shareable} />
      <div className="flex flex-wrap gap-3">
        <ShareWorkoutButton
          card={card}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50"
        />
        <Link href={`/workout/${dayId}`} className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent">
          {t.common.shareCard.viewWorkout}
        </Link>
        <Link href="/today" className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent">
          {s.skipToToday}
        </Link>
      </div>
    </div>
  );
}
