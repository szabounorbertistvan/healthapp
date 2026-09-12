"use client";
import type { TrainingLoad, TrainingLoadCategory } from "@healthapp/shared";
import type { TrainingLoadSummary } from "@/lib/types";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { parseDay } from "@/lib/week";
import { Card } from "./ui";

/** Category → semantic tone. Light work is quiet, moderate is the brand gold, hard runs amber, very hard reads as a warning. */
const TONE: Record<TrainingLoadCategory, { text: string; bar: string; soft: string }> = {
  very_light: { text: "text-ink-faint", bar: "bg-ink-faint", soft: "bg-bg" },
  light: { text: "text-ink-soft", bar: "bg-ink-soft", soft: "bg-bg" },
  moderate: { text: "text-accent-ink", bar: "bg-accent", soft: "bg-accent-soft" },
  hard: { text: "text-warn", bar: "bg-warn", soft: "bg-warn-soft" },
  very_hard: { text: "text-risk", bar: "bg-risk", soft: "bg-risk-soft" },
};

/** "Load 82 · Hard" as a compact inline chip — history rows and the coach roster. */
export function TrainingLoadBadge({ load, showLabel = true }: { load: TrainingLoad; showLabel?: boolean }) {
  const { t } = useI18n();
  const l = t.common.trainingLoad;
  const tone = TONE[load.category];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${tone.soft} ${tone.text}`}>
      {showLabel ? <span className="font-medium opacity-80">{l.short}</span> : null}
      {load.score}
      <span className="font-medium opacity-80">· {l.category[load.category]}</span>
    </span>
  );
}

/**
 * The score card on a training day: the number, its band, and a segmented
 * meter with the five bands marked so 82 reads as "deep into Hard" at a glance.
 */
export function TrainingLoadCard({ load, when }: { load: TrainingLoad; when?: string }) {
  const { t, locale } = useI18n();
  const l = t.common.trainingLoad;
  const tone = TONE[load.category];
  const facts = [
    load.duration_min !== null ? fill(l.minutes, { min: load.duration_min }) : null,
    load.exercises > 0 ? fill(l.exercises, { count: load.exercises }) : null,
    `${load.sets} ${t.clientApp.workoutDay.sets}`,
    `${load.volume_kg.toLocaleString(locale === "ro" ? "ro-RO" : "en-GB")} kg`,
  ].filter((x): x is string => x !== null);

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {l.title}
          {when ? <span className="ml-2 normal-case tracking-normal text-ink-faint">· {l.lastSession} {when}</span> : null}
        </p>
      </div>
      <div className="mt-1 flex items-baseline gap-3">
        <p className="text-4xl font-bold tabular-nums leading-none">{load.score}</p>
        <p className={`text-base font-semibold ${tone.text}`}>{l.category[load.category]}</p>
      </div>
      <LoadMeter score={load.score} category={load.category} />
      <p className="mt-2 text-xs text-ink-soft">{facts.join(" · ")}</p>
      <p className="mt-1 text-[11px] text-ink-faint">{l.explainer}</p>
    </Card>
  );
}

/** Five band segments under a single filled bar — the bands are the scale, the fill is the score. */
function LoadMeter({ score, category }: { score: number; category: TrainingLoadCategory }) {
  const tone = TONE[category];
  const bands = [30, 20, 20, 15, 15]; // widths of the five categories in points
  return (
    <div className="mt-3">
      <div className="relative h-2 overflow-hidden rounded-full bg-bg">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${score}%` }} />
      </div>
      <div className="mt-1 flex gap-0.5" aria-hidden>
        {bands.map((w, i) => (
          <span
            key={i}
            className={`h-0.5 rounded-full ${i <= bandIndex(category) ? tone.bar : "bg-line"}`}
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function bandIndex(c: TrainingLoadCategory): number {
  return ["very_light", "light", "moderate", "hard", "very_hard"].indexOf(c);
}

/**
 * Today's week-over-week panel: this week against last, the change, and a
 * 14-day bar chart. Inline SVG for the same reason Sparkline is — one series,
 * no interaction, no dependency.
 */
export function TrainingLoadSummaryCard({ summary }: { summary: TrainingLoadSummary }) {
  const { t, locale } = useI18n();
  const l = t.common.trainingLoad;
  const { trend, daily } = summary;
  const nothingYet = daily.every((d) => d.load === 0) && summary.last_week === 0;
  const deltaTone =
    trend.direction === "increased" ? "text-accent-ink" : trend.direction === "decreased" ? "text-warn" : "text-ink-soft";
  const deltaText =
    trend.delta_pct === null
      ? l.noPrevious
      : `${trend.delta_pct > 0 ? "+" : ""}${trend.delta_pct.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{l.title}</p>
        <p className="text-xs text-ink-faint">
          {l.last7Days}: <b className="tabular-nums text-ink">{summary.last_7_days}</b>
        </p>
      </div>
      {nothingYet ? (
        <p className="mt-2 text-sm text-ink-soft">{l.noSessions}</p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs text-ink-faint">{l.thisWeek}</p>
              <p className="text-2xl font-bold tabular-nums">{summary.this_week}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint">{l.lastWeek}</p>
              <p className="text-2xl font-bold tabular-nums text-ink-soft">{summary.last_week}</p>
            </div>
            <div>
              <p className={`text-xs ${deltaTone}`}>
                {trend.direction === "increased" ? "↑" : trend.direction === "decreased" ? "↓" : "→"}{" "}
                {l.direction[trend.direction]}
              </p>
              <p className={`whitespace-nowrap font-bold tabular-nums ${deltaTone} ${trend.delta_pct === null ? "text-sm leading-8" : "text-2xl"}`}>
                {deltaText}
              </p>
            </div>
          </div>
          <LoadBars daily={daily} />
        </>
      )}
    </Card>
  );
}

function LoadBars({ daily }: { daily: { day: string; load: number }[] }) {
  const { t, locale } = useI18n();
  const l = t.common.trainingLoad;
  const max = Math.max(100, ...daily.map((d) => d.load));
  const width = 100;
  const height = 40;
  const gap = 1.2;
  const bw = (width - gap * (daily.length - 1)) / daily.length;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-12 w-full"
        role="img"
        aria-label={fill(l.chartLabel, { days: daily.length })}
      >
        {daily.map((d, i) => {
          const h = d.load > 0 ? Math.max(1.5, (d.load / max) * height) : 0.8;
          return (
            <rect
              key={d.day}
              x={i * (bw + gap)}
              y={height - h}
              width={bw}
              height={h}
              rx={0.6}
              fill={d.load > 0 ? "var(--color-accent)" : "var(--color-line)"}
            />
          );
        })}
      </svg>
      <div className="mt-1 grid text-center text-[10px] text-ink-faint" style={{ gridTemplateColumns: `repeat(${daily.length}, 1fr)` }}>
        {daily.map((d) => (
          <span key={d.day}>{weekday.format(parseDay(d.day))}</span>
        ))}
      </div>
    </div>
  );
}
