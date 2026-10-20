import Link from "next/link";
import { notFound } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { getProfile } from "@/lib/data";
import { getMyWorkoutWithFeedback } from "@/lib/workout-feedback";
import { SessionWithFeedback } from "@/components/workout-feedback";
import { NavIcon } from "@/components/client-nav";

/**
 * One of the person's own finished workouts, set by set, with what their coach
 * wrote on it (20261207110000) — where a coach_feedback notice opens. Reading
 * it marks those comments read. Someone else's session id is a 404.
 */
export default async function WorkoutSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t, locale }, { id }, profile] = await Promise.all([getI18n(), params, getProfile()]);
  const session = await getMyWorkoutWithFeedback(id, locale === "ro" ? "ro" : "en");
  if (!session) notFound();
  const m = t.coachWidgets.workoutFeedback;
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/workout" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-accent-ink">
        <NavIcon d="m15 6-6 6 6 6" className="h-3.5 w-3.5" />
        {t.common.nav.training}
      </Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{session.name ?? m.freeWorkout}</h1>
      <p className="mt-2 text-[13px] tabular-nums text-ink-faint">
        {new Date(session.started_at).toLocaleString(locale === "ro" ? "ro-RO" : "en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
      </p>
      <div className="mt-5">
        <SessionWithFeedback session={session} unit={profile?.weight_unit === "lb" ? "lb" : "kg"} />
      </div>
    </div>
  );
}
