import Link from "next/link";
import { getMyMeasurements, getMyPrs, getMySessions } from "@/lib/client-data";
import { getProfile } from "@/lib/data";
import { getMyPhotos } from "@/lib/photos-data";
import { getPlan, inHistory } from "@/lib/plan";
import { getMyProgressTraining } from "@/lib/progress-data";
import { parseProgressParams } from "@/lib/progress-params";
import { getExerciseHistory } from "@/lib/exercise-analytics-data";
import { getMyFitnessScore } from "@/lib/fitness-score-data";
import { getMyStreak } from "@/lib/streak-data";
import { UpgradeHint } from "@/components/upgrade";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { ProgressPhotos } from "@/components/progress-photos";
import { Card, EmptyState } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { MeasurementForm } from "@/components/measurement-form";
import {
  BodyTrends,
  ComparisonNote,
  ConsistencyOverview,
  ExerciseProgress,
  InsightsCard,
  RangeTabs,
  SectionTabs,
  StrengthOverview,
} from "@/components/advanced-progress";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import {
  bodyProgress,
  cmToDisplay,
  exerciseStats,
  formatWeight,
  kgToDisplay,
  periodBuckets,
  progressInsights,
  progressWindows,
  strengthHighlights,
  topExercises,
  trainingProgress,
} from "@healthapp/shared";

/**
 * Progress: one time range (7 / 30 / 90 / 365 days / all time) compared with
 * the range before it, across three tabs — Body, Strength, Consistency — so a
 * phone shows one section at a time instead of every chart at once.
 *
 * Everything is computed here, on the server, from the person's own rows:
 * packages/shared/progress folds sessions (scored by the same loadOf() as
 * every other surface) and measurements into windows, comparisons and
 * insights; the chosen lift goes through the exercise page's own read and
 * exerciseStats(); the fitness score and streak are their existing reads. The
 * client components only format.
 *
 * The plan gates what it gated before this page grew: charts and the fitness
 * score trend are `progressCharts`, the PR list is cut to the top few without
 * it, the measurement list and photos follow `historyDays`. All open while the
 * paywall is off. The comparisons and insights are new and not gated.
 */
export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const state = parseProgressParams(await searchParams);
  const { tab } = state;
  // One wave: everything the headline and insights need, plus whatever the
  // open tab alone needs — a closed tab costs no query.
  const [{ t, locale }, profile, plan, allMeasurements, allPrs, sessions, training, allPhotos, fitness, streak] =
    await Promise.all([
      getI18n(),
      getProfile(),
      getPlan(),
      // The whole history, not the default 12 rows: this is the one screen whose
      // job is the long view, and a trend cut off at twelve weigh-ins is a
      // different trend.
      getMyMeasurements(MEASUREMENT_HISTORY),
      getMyPrs(),
      getMySessions(200),
      getMyProgressTraining(state.range),
      tab === "body" ? getMyPhotos() : Promise.resolve([]),
      tab === "strength" ? getMyFitnessScore() : Promise.resolve(null),
      tab === "consistency" ? getMyStreak() : Promise.resolve(null),
    ]);
  if (!training) {
    return <EmptyState title={t.clientApp.today.notSignedInTitle} hint={t.clientApp.today.notSignedInHint} />;
  }

  // Free keeps the last 30 days of weigh-ins and photos and the top few PRs;
  // the headline figures (sessions, volume, PR count) always count everything,
  // so no number here ever disagrees with the coach's view of the same person.
  const measurements = allMeasurements.filter((m) => inHistory(plan, m.taken_on));
  const photos = allPhotos.filter((p) => inHistory(plan, p.date));
  const hiddenHistory = measurements.length < allMeasurements.length;
  const charts = plan.e.progressCharts;
  const chartsLocked = charts ? null : <UpgradeHint card feature="charts" upgrade={plan.upgrade} />;
  const prs = charts ? allPrs : allPrs.slice(0, FREE_PRS_SHOWN);

  // This is a server component, so units come off the profile rather than the
  // client-side UnitsProvider the charts use.
  const weightUnit = profile?.weight_unit ?? "kg";
  const lengthUnit = profile?.length_unit ?? "cm";

  // ---- the period and the one before it ----
  const firstMeasurement = allMeasurements[0]?.taken_on ?? null;
  const earliest =
    training.firstDay && firstMeasurement
      ? training.firstDay < firstMeasurement
        ? training.firstDay
        : firstMeasurement
      : (training.firstDay ?? firstMeasurement);
  const windows = progressWindows(training.today, state.range, earliest);
  const body = bodyProgress(
    allMeasurements.map((m) => ({ day: m.taken_on, weight_kg: m.weight_kg, circumferences: m.circumferences })),
    windows,
  );
  const trainingNow = trainingProgress(training.sessions, windows);
  const highlights = strengthHighlights(training.sessions, windows);
  const insights = progressInsights({ training: trainingNow, strength: highlights, body });
  const buckets = periodBuckets(training.sessions, windows.current);

  // Lift names come off the PR list the page already reads: a loaded lift's
  // first set is always a PR, so this names every lift a 1RM exists for.
  const names: Record<string, string> = {};
  for (const pr of allPrs) if (pr.exercise_id) names[pr.exercise_id] = pr.exercise;
  const trained = topExercises(training.sessions, windows.current).filter((e) => names[e.exercise_id]);
  const options = (trained.length > 0 ? trained.map((e) => e.exercise_id) : Object.keys(names))
    .slice(0, EXERCISE_OPTIONS)
    .map((id) => ({ id, name: names[id]! }));
  const selected = state.exercise && names[state.exercise] ? state.exercise : (options[0]?.id ?? null);
  if (selected && !options.some((o) => o.id === selected)) options.unshift({ id: selected, name: names[selected]! });

  // The one read that has to wait: which lift is shown depends on the sessions.
  const history = tab === "strength" && selected ? await getExerciseHistory(selected) : null;
  const liftSessions = (history?.sessions ?? []).filter((s) => s.at.slice(0, 10) >= windows.current.start);

  const latest = body.weight.latest;
  const totalVolume = sessions.reduce((sum, s) => sum + s.volume_exact_kg, 0);

  return (
    <div className="@container mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
          {t.common.nav.progress}
        </h1>
        <RangeTabs state={state} />
      </div>
      <div className="mt-2">
        <ComparisonNote range={state.range} hasPrevious={windows.previous !== null} />
        {training.truncated ? (
          <p className="mt-1 text-[12px] text-ink-faint">{t.clientApp.advancedProgress.truncated}</p>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-5 sm:gap-4 lg:grid-cols-4">
        <Stat
          icon={ICON.scale}
          label={t.clientApp.progress.currentWeight}
          value={latest ? String(kgToDisplay(latest.value, weightUnit)) : "—"}
          unit={latest ? weightUnit : undefined}
        />
        <Stat icon={ICON.sessions} label={t.clientApp.progress.sessionsLogged} value={String(sessions.length)} />
        {/* Tonnes only make sense in metric, so the total is shown in whatever
            unit the person reads — a big number with separators, no decimal. */}
        <Stat
          icon={ICON.volume}
          label={t.clientApp.progress.totalVolume}
          value={formatWeight(totalVolume, weightUnit, { locale, big: true }).replace(` ${weightUnit}`, "")}
          unit={weightUnit}
        />
        <Stat icon={ICON.trophy} label={t.clientApp.progress.personalRecords} value={String(allPrs.length)} accent />
      </div>

      <div className="mt-4 sm:mt-5">
        <InsightsCard insights={insights} names={names} />
      </div>

      <div className="mt-5 sm:mt-6">
        <SectionTabs state={state} />
      </div>

      {tab === "body" ? (
        <div className="mt-4 grid grid-cols-1 items-start gap-4 sm:mt-5 @3xl:grid-cols-2 @3xl:gap-5">
          <BodyTrends body={body} chartsLocked={chartsLocked} />

          <div className="space-y-4">
            <MeasurementForm />

            {/* Photos sit with the weigh-in, not in a gallery of their own: they
                answer the same question the scale does, on the weeks it lies. */}
            <ProgressPhotos
              photos={photos}
              configured={cloudinaryConfigured()}
              compare={plan.e.photoCompare}
              olderHidden={photos.length < allPhotos.length ? (plan.e.historyDays ?? 0) : null}
              upgrade={plan.upgrade}
            />

            {/* ---- every measurement ---- */}
            {measurements.length === 0 && hiddenHistory ? (
              <UpgradeHint card feature="history" upgrade={plan.upgrade} values={{ days: plan.e.historyDays ?? 0 }} />
            ) : measurements.length === 0 ? (
              <EmptyState
                plain
                title={t.clientApp.progress.noMeasurementsTitle}
                hint={t.clientApp.progress.noMeasurementsHint}
              />
            ) : (
              <Card plain className="overflow-hidden p-0">
                <div className="px-5 pb-2 pt-[18px]">
                  <SectionLabel icon={ICON.ruler}>{t.clientApp.progress.measurements}</SectionLabel>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-[13.5px]">
                    <thead>
                      <tr className="border-b border-line/60 text-left text-[11px] uppercase tracking-wider text-ink-faint">
                        <th className="px-5 py-3 font-semibold">{t.clientApp.progress.date}</th>
                        <th className="px-5 py-3 text-right font-semibold">
                          {t.clientApp.progress.weight} ({weightUnit})
                        </th>
                        <th className="px-5 py-3 text-right font-semibold">
                          {t.clientApp.progress.waist} ({lengthUnit})
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {[...measurements].reverse().map((m) => (
                        <tr key={m.id}>
                          <td className="whitespace-nowrap px-5 py-3 tabular-nums text-ink-soft">{m.taken_on}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums">
                            {m.weight_kg !== null ? kgToDisplay(m.weight_kg, weightUnit) : "—"}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums">
                            {m.waist_cm !== null ? cmToDisplay(m.waist_cm, lengthUnit) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hiddenHistory ? (
                  <UpgradeHint
                    feature="history"
                    upgrade={plan.upgrade}
                    values={{ days: plan.e.historyDays ?? 0 }}
                    className="mx-4 mb-4 mt-2"
                  />
                ) : null}
              </Card>
            )}
          </div>
        </div>
      ) : null}

      {tab === "strength" ? (
        <div className="mt-4 space-y-6 sm:mt-5">
          <StrengthOverview
            training={trainingNow}
            highlights={highlights}
            names={names}
            fitness={fitness}
            buckets={buckets}
            chartsLocked={chartsLocked}
          />
          <ExerciseProgress
            state={state}
            options={options}
            selected={selected}
            sessions={liftSessions}
            stats={exerciseStats(liftSessions)}
            todayIso={training.today}
            chartsLocked={chartsLocked}
          />

          {/* ---- best lifts, all time ---- */}
          <Card plain className="overflow-hidden p-0">
            <div className="px-5 pb-1 pt-[18px]">
              <SectionLabel icon={ICON.trophy}>{t.clientApp.progress.personalRecords}</SectionLabel>
            </div>
            {prs.length === 0 ? (
              <p className="px-5 pb-[18px] pt-2 text-[13px] text-ink-faint">{t.clientApp.progress.noPrs}</p>
            ) : (
              <ul className="mt-1 divide-y divide-line/60">
                {prs.map((pr) => (
                  <li key={pr.exercise} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    {pr.exercise_id ? (
                      <Link
                        href={`/exercises/${pr.exercise_id}`}
                        className="min-w-0 truncate text-[14px] font-semibold hover:text-accent-ink"
                      >
                        {pr.exercise}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate text-[14px] font-semibold">{pr.exercise}</span>
                    )}
                    <span className="shrink-0 text-right">
                      <span className="font-display text-[17px] font-extrabold tabular-nums leading-none">
                        {kgToDisplay(pr.best, weightUnit)}
                        <span className="ml-1 font-sans text-[12px] font-medium text-ink-faint">{weightUnit}</span>
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-ink-faint">
                        {t.clientApp.progress.est1Rm} · {timeAgo(pr.at, locale)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {allPrs.length > prs.length ? (
              <UpgradeHint
                feature="prs"
                upgrade={plan.upgrade}
                values={{ count: allPrs.length - prs.length, shown: prs.length }}
                className="mx-4 mb-4 mt-1"
              />
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === "consistency" ? (
        <div className="mt-4 sm:mt-5">
          <ConsistencyOverview
            training={trainingNow}
            streak={streak ? { current: streak.summary.current, longest: streak.summary.longest } : null}
            buckets={buckets}
            chartsLocked={chartsLocked}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Far past anyone's weigh-in count, but bounded: an unbounded select is how a
    read that is fine for a year becomes a timeout in the third. */
const MEASUREMENT_HISTORY = 500;

/** Personal records a plan without progress charts lists (the heaviest first). */
const FREE_PRS_SHOWN = 3;

/** Lifts offered in the Strength picker — the most-trained of the period. */
const EXERCISE_OPTIONS = 12;

/** The 24-box icon paths this screen uses. */
const ICON = {
  scale: "M12 4a2 2 0 1 0 0 4 2 2 0 1 0 0-4M12 8v3M5 11h14l-2.5 9h-9zM8 14h8",
  sessions: "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8",
  volume: "M4 19h16M7 19V9M12 19V5M17 19v-6",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  ruler: "M3 9h18v6H3zM7 9v3M11 9v4M15 9v3M19 9v4",
} as const;

/** An eyebrow with its icon — the heading of a block on this screen. */
function SectionLabel({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
      <NavIcon d={icon} className="h-[18px] w-[18px] text-accent-ink" />
      {children}
    </p>
  );
}

/** One headline figure on its own card: an icon, the label, the number, its unit. */
function Stat({
  icon,
  label,
  value,
  unit,
  accent = false,
}: {
  icon: string;
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-3xl bg-surface px-4 py-5 text-center sm:gap-3 sm:py-6">
      <NavIcon d={icon} className="h-10 w-10 shrink-0 text-accent-ink sm:h-12 sm:w-12" />
      <p className="w-full truncate text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p
        className={`font-display text-[32px] font-extrabold tabular-nums leading-none sm:text-[40px] ${
          accent ? "text-accent-ink" : ""
        }`}
      >
        {value}
        {unit ? <span className="ml-1.5 font-sans text-sm font-medium text-ink-faint">{unit}</span> : null}
      </p>
    </div>
  );
}
