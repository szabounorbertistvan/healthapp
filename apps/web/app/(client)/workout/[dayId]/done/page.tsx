import Link from "next/link";
import { redirect } from "next/navigation";
import { getShareableSession } from "@/lib/social-data";
import { getMyStreak } from "@/lib/streak-data";
import { getProfile } from "@/lib/data";
import { shareCardFromSession } from "@/lib/share-card";
import { shareProfileOf } from "@/lib/share-card-data";
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
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{s.workoutCompleted}</h1>
      {streak ? <StreakAfterWorkout view={streak} /> : null}
      <WorkoutDoneShare session={shareable} />
      <div className="flex flex-wrap gap-3">
        <ShareWorkoutButton
          card={card}
          className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
        />
        <Link
          href={`/workout/${dayId}`}
          className="inline-flex h-11 items-center rounded-full bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          {t.common.shareCard.viewWorkout}
        </Link>
        <Link
          href="/today"
          className="inline-flex h-11 items-center rounded-full bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          {s.skipToToday}
        </Link>
      </div>
    </div>
  );
}
