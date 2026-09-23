"use client";
import { usePlan } from "@/lib/plan-client";
import { UpgradeHint } from "./upgrade";
import Link from "next/link";
import {
  FITNESS_SCORE_MIN_WORKOUTS,
  FITNESS_SCORE_WEIGHTS,
  type FitnessScore,
  type FitnessScoreBand,
  type FitnessScoreTrend,
} from "@healthapp/shared";
import type { FitnessScoreView } from "@/lib/fitness-score-data";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { parseDay } from "@/lib/week";
import { ChallengeProgressBar } from "./challenges";
import { Card } from "./ui";

/** Band → tone. Quiet at the start, brand gold once activity is established. */
const BAND_TONE: Record<FitnessScoreBand, string> = {
  getting_started: "text-ink-soft",
  building: "text-ink-soft",
  developing: "text-accent-ink",
  strong_activity: "text-accent-ink",
};

type ComponentKey = keyof typeof FITNESS_SCORE_WEIGHTS;
const COMPONENTS: readonly ComponentKey[] = ["trainingLoad", "consistency", "frequency", "volume"];

function subscore(score: FitnessScore, key: ComponentKey): number {
  switch (key) {
    case "trainingLoad": return score.trainingLoadScore;
    case "consistency": return score.consistencyScore;
    case "frequency": return score.frequencyScore;
    case "volume": return score.volumeScore;
  }
}

function useFitnessText() {
  const { t, locale } = useI18n();
  const f = t.common.fitnessScore;
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const nf = new Intl.NumberFormat(tag);
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" });
  return {
    f,
    n: (v: number) => nf.format(v),
    date: (day: string) => df.format(parseDay(day)),
    period: (p: { start: string; end: string }) => fill(f.periodLabel, { start: df.format(parseDay(p.start)), end: df.format(parseDay(p.end)) }),
    /** The supporting number behind a component, as a sentence. */
    fact: (score: FitnessScore, key: ComponentKey): string => {
      switch (key) {
        case "trainingLoad": return fill(f.facts.averageLoad, { value: Math.round(score.averageTrainingLoad) });
        case "consistency":
          return score.activeWorkoutDays === 1 ? f.facts.activeDayOne : fill(f.facts.activeDays, { count: score.activeWorkoutDays });
        case "frequency":
          return score.completedWorkouts === 1 ? f.facts.workoutOne : fill(f.facts.workouts, { count: score.completedWorkouts });
        case "volume": return fill(f.facts.volume, { kg: nf.format(Math.round(score.totalVolume)) });
      }
    },
    band: (b: FitnessScoreBand | null) => (b === null ? f.building : f.band[b]),
    signed: (v: number) => (v > 0 ? `+${nf.format(v)}` : nf.format(v)),
  };
}

// ---------- pieces ----------

/** The big number and its band — or "Building" with how far along the unlock is. */
function ScoreHeadline({ score, size = "md" }: { score: FitnessScore; size?: "md" | "lg" }) {
  const x = useFitnessText();
  const number = size === "lg" ? "text-[56px]" : "text-[40px]";
  if (score.status === "building") {
    return (
      <div>
        <p className={`font-display ${size === "lg" ? "text-[28px]" : "text-xl"} font-extrabold leading-none`}>{x.f.building}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{x.f.buildingHint}</p>
        <p className="mt-1 text-[12px] tabular-nums text-ink-faint">
          {fill(x.f.buildingProgress, { done: score.completedWorkouts, needed: FITNESS_SCORE_MIN_WORKOUTS })}
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-baseline gap-3">
      <p className={`font-display ${number} font-extrabold tabular-nums leading-none`}>{score.score}</p>
      <p className={`text-base font-semibold ${BAND_TONE[score.band!]}`}>{x.band(score.band)}</p>
    </div>
  );
}

/** Four rows: name, subscore, bar. `facts` adds the supporting number under each. */
function Breakdown({ score, facts = false, weights = false }: { score: FitnessScore; facts?: boolean; weights?: boolean }) {
  const x = useFitnessText();
  return (
    <ul className={facts ? "space-y-4" : "space-y-2.5"}>
      {COMPONENTS.map((key) => {
        const value = subscore(score, key);
        return (
          <li key={key}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate font-medium">
                {x.f.components[key]}
                {weights ? (
                  <span className="ml-1.5 text-[11px] font-semibold text-ink-faint">
                    {fill(x.f.weight, { pct: Math.round(FITNESS_SCORE_WEIGHTS[key] * 100) })}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{Math.round(value)}</span>
            </div>
            <div className="mt-1.5">
              <ChallengeProgressBar pct={value} completed={value >= 100} height="h-1.5" />
            </div>
            {facts ? <p className="mt-1.5 text-[12.5px] tabular-nums text-ink-soft">{x.fact(score, key)}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** "+5 vs previous 28 days", "No change", or why there is nothing to compare. */
function TrendLine({ trend }: { trend: FitnessScoreTrend }) {
  const x = useFitnessText();
  if (trend.delta === null) return <p className="text-[12.5px] text-ink-faint">{x.f.trendNoPrevious}</p>;
  const tone = trend.direction === "up" ? "text-accent-ink" : trend.direction === "down" ? "text-warn" : "text-ink-soft";
  return (
    <p className="text-[12.5px] text-ink-faint">
      <span className={`font-semibold tabular-nums ${tone}`}>
        {trend.direction === "stable" ? x.f.trendNoChange : x.signed(trend.delta)}
      </span>{" "}
      {x.f.trendVsPrevious}
    </p>
  );
}

// ---------- the cards ----------

/**
 * Today's card: the score, its band, the four subscores and the trend, with
 * a link to the full page. Building shows the unlock hint instead of a
 * number — never a 0 that looks like a result.
 */
export function FitnessScoreCard({ view }: { view: FitnessScoreView }) {
  const x = useFitnessText();
  const { e: plan, upgrade } = usePlan();
  const { current, trend } = view;
  return (
    <Card plain>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{x.f.title}</p>
        <p className="text-[11px] text-ink-faint">{x.f.last28Days}</p>
      </div>
      <div className="mt-2">
        <ScoreHeadline score={current} />
      </div>
      {/* The number is free; how it moved and what it is made of are Premium. */}
      {plan.progressCharts && current.status === "active" ? (
        <div className="mt-1.5">
          <TrendLine trend={trend} />
        </div>
      ) : null}
      <div className="mt-4">
        {plan.progressCharts ? <Breakdown score={current} /> : <UpgradeHint feature="fitnessTrend" upgrade={upgrade} />}
      </div>
      <Link href="/fitness-score" className="mt-3.5 inline-block text-[12.5px] font-semibold text-accent-ink hover:underline">
        {x.f.viewDetails} →
      </Link>
    </Card>
  );
}

/**
 * The /fitness-score page body: the headline, the trend against the block
 * before, every component with its supporting number and weight, and how
 * the whole thing is put together.
 */
export function FitnessScoreDetail({ view }: { view: FitnessScoreView }) {
  const x = useFitnessText();
  const { e: plan, upgrade } = usePlan();
  const { current, previous, trend } = view;
  return (
    <div className="space-y-4">
      <Card plain>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{x.f.title}</p>
          <p className="text-[11px] tabular-nums text-ink-faint">
            {x.f.last28Days} · {x.period(current.period)}
          </p>
        </div>
        <div className="mt-3">
          <ScoreHeadline score={current} size="lg" />
        </div>
      </Card>

      {plan.progressCharts ? (
      <>
      <Card plain>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{x.f.trendTitle}</p>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-ink-faint">{x.f.currentPeriod}</p>
            <p className="text-2xl font-bold tabular-nums">{current.score ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-ink-faint">{x.f.previousPeriod}</p>
            <p className="text-2xl font-bold tabular-nums text-ink-soft">{previous.score ?? "—"}</p>
            <p className="mt-0.5 text-[11px] tabular-nums text-ink-faint">{x.period(previous.period)}</p>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <TrendLine trend={trend} />
          </div>
        </div>
      </Card>

      <Card plain>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{x.f.weights}</p>
          <p className="text-[11px] text-ink-faint">{x.f.last28Days}</p>
        </div>
        <div className="mt-3">
          <Breakdown score={current} facts weights />
        </div>
      </Card>
      </>
      ) : (
        <UpgradeHint card feature="fitnessTrend" upgrade={upgrade} />
      )}

      <Card plain>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{x.f.howTitle}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{x.f.howIntro}</p>
        <dl className="mt-3 space-y-2.5">
          {COMPONENTS.map((key) => (
            <div key={key}>
              <dt className="text-[13px] font-semibold">
                {x.f.components[key]}{" "}
                <span className="text-[11px] font-semibold text-ink-faint">
                  {fill(x.f.weight, { pct: Math.round(FITNESS_SCORE_WEIGHTS[key] * 100) })}
                </span>
              </dt>
              <dd className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">{x.f.how[key]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

/**
 * The coach's section on a client page: score, band, the four subscores with
 * their supporting numbers, and the period. Training data only — nothing
 * about food or measurements comes through here.
 */
export function FitnessScoreCoachCard({ view }: { view: FitnessScoreView }) {
  const x = useFitnessText();
  const { current, trend } = view;
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{x.f.coachTitle}</p>
        <p className="text-[11px] tabular-nums text-ink-faint">
          {x.f.last28Days} · {x.period(current.period)}
        </p>
      </div>
      {current.status === "building" ? (
        <>
          <p className="mt-2 font-display text-xl font-extrabold leading-none">{x.f.building}</p>
          <p className="mt-2 text-[13px] text-ink-soft">
            {fill(x.f.coachBuilding, { done: current.completedWorkouts, needed: FITNESS_SCORE_MIN_WORKOUTS })}
          </p>
        </>
      ) : (
        <>
          <div className="mt-2">
            <ScoreHeadline score={current} />
          </div>
          <div className="mt-1.5">
            <TrendLine trend={trend} />
          </div>
        </>
      )}
      <div className="mt-4">
        <Breakdown score={current} facts />
      </div>
    </Card>
  );
}
