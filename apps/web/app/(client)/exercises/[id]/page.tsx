import Link from "next/link";
import { notFound } from "next/navigation";
import { defaultRange } from "@healthapp/shared";
import { getExerciseHistory, getExerciseProfile } from "@/lib/exercise-analytics-data";
import { getPlan, inHistory } from "@/lib/plan";
import { isoDay } from "@/lib/dates";
import { Card } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { ExerciseAnalytics } from "@/components/exercise-analytics";
import { ExerciseVideo } from "@/components/exercise-video";
import { UpgradeHint } from "@/components/upgrade";
import { getI18n } from "@/lib/i18n/server";

/**
 * One lift, and what this person has done with it: the header facts, the
 * summary, the progressions and rep records, every completed session, and the
 * demo video with the how-to.
 *
 * Two branches built this page at once (exercise analytics here, the exercise
 * page with rep records, video and paywall on main); this is the merge of
 * both, on one domain module — packages/shared/src/exercise-analytics.ts.
 *
 * Everything below the header comes from the person's own logged_sets: policy
 * `sets_owner` scopes the read to auth.uid(), so this route cannot show one
 * person another person's history whatever id is typed into the address bar.
 * The exercise row is library data, readable by anyone signed in; the video
 * links follow `exercise_video_links` RLS (yours, and your active coach's).
 *
 * The plan (lib/plan) gates what main gated: the charts and rep records are
 * `progressCharts`, the history list follows `historyDays`. Both are open
 * while the paywall is off. The summary always covers every session.
 */
export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Four independent questions, one wave.
  const [{ t, locale }, profile, history, plan] = await Promise.all([
    getI18n(),
    getExerciseProfile(id),
    getExerciseHistory(id),
    getPlan(),
  ]);
  if (!profile) notFound();
  const d = t.clientApp.exerciseDetail;

  const name = (locale === "ro" ? profile.name_ro : null) ?? profile.name_en;
  const instructions = (locale === "ro" ? profile.instructions_ro : null) ?? profile.instructions_en;
  const steps = (instructions ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const today = isoDay();
  const facts: { label: string; value: string }[] = [
    { label: d.equipment, value: profile.equipment ?? "" },
    { label: d.level, value: profile.level ?? "" },
    { label: d.category, value: profile.category ?? "" },
    { label: d.mechanic, value: profile.mechanic ?? "" },
    { label: d.force, value: profile.force ?? "" },
  ].filter((f) => f.value !== "");

  const historySessions = history.sessions.filter((s) => inHistory(plan, s.at));

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
        records={history.records}
        initialRange={defaultRange(history.sessions, today)}
        todayIso={today}
        truncated={history.truncated}
        historySessions={historySessions}
        chartsLocked={plan.e.progressCharts ? null : <UpgradeHint card feature="charts" upgrade={plan.upgrade} />}
        historyLocked={
          historySessions.length < history.sessions.length ? (
            <UpgradeHint feature="history" upgrade={plan.upgrade} values={{ days: plan.e.historyDays ?? 0 }} />
          ) : null
        }
      />

      {/* The demo and the how-to: the same ExerciseVideo the logger shows
          collapsed, here open, with this person's own link / coach's / row's. */}
      <Card plain className="mt-6">
        <ExerciseVideo exerciseId={profile.id} videoUrl={profile.video_url} source={profile.video_source} mine={profile.mine} />
        {steps.length > 0 ? (
          <>
            <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{d.howTo}</p>
            <ol className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-ink-soft">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-bold tabular-nums text-accent-ink">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </Card>
    </div>
  );
}
