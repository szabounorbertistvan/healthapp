import Link from "next/link";
import { notFound } from "next/navigation";
import { defaultRange } from "@healthapp/shared";
import { getExerciseHistory, getExerciseProfile } from "@/lib/exercise-analytics-data";
import { isoDay } from "@/lib/dates";
import { NavIcon } from "@/components/client-nav";
import { ExerciseAnalytics } from "@/components/exercise-analytics";
import { getI18n } from "@/lib/i18n/server";

/**
 * One lift, and what this person has done with it.
 *
 * Everything below the header comes from their own logged_sets: policy
 * `sets_owner` scopes the read to auth.uid(), so this route cannot show one
 * person another person's history whatever id is typed into the address bar.
 * The exercise row itself is library data and readable by anyone signed in —
 * the name and the muscle list are not private.
 */
export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t, locale } = await getI18n();
  const { id } = await params;
  const d = t.clientApp.exerciseDetail;

  // Two independent questions, so one wave rather than two.
  const [profile, history] = await Promise.all([getExerciseProfile(id), getExerciseHistory(id)]);
  if (!profile) notFound();

  const name = (locale === "ro" ? profile.name_ro : null) ?? profile.name_en;
  const today = isoDay();
  const facts: { label: string; value: string }[] = [
    { label: d.equipment, value: profile.equipment ?? "" },
    { label: d.level, value: profile.level ?? "" },
    { label: d.category, value: profile.category ?? "" },
    { label: d.mechanic, value: profile.mechanic ?? "" },
    { label: d.force, value: profile.force ?? "" },
  ].filter((f) => f.value !== "");

  return (
    <div className="mx-auto max-w-[1600px]">
      <Link
        href="/exercises"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-accent-ink"
      >
        <NavIcon d="m15 6-6 6 6 6" className="h-3.5 w-3.5" />
        {d.back}
      </Link>

      <header className="mt-3">
        <h1 className="font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-[28px]">{name}</h1>
        <dl className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
          {profile.primary_muscles.length > 0 ? (
            <div className="flex gap-1.5">
              <dt className="text-ink-faint">{d.primaryMuscle}</dt>
              <dd className="font-semibold text-accent-ink">{profile.primary_muscles.join(", ")}</dd>
            </div>
          ) : null}
          {profile.secondary_muscles.length > 0 ? (
            <div className="flex gap-1.5">
              <dt className="text-ink-faint">{d.secondaryMuscles}</dt>
              <dd className="font-semibold text-ink-soft">{profile.secondary_muscles.join(", ")}</dd>
            </div>
          ) : null}
          {facts.map((f) => (
            <div key={f.label} className="flex gap-1.5">
              <dt className="text-ink-faint">{f.label}</dt>
              <dd className="font-semibold text-ink-soft">{f.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <ExerciseAnalytics
        sessions={history.sessions}
        stats={history.stats}
        initialRange={defaultRange(history.sessions, today)}
        todayIso={today}
        truncated={history.truncated}
      />
    </div>
  );
}
