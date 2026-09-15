"use client";
import type { Macros } from "@healthapp/shared";
import { Card } from "./ui";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";

/** A macro against its target. Over-target fills to 100% and turns amber. */
export function MacroBar({
  label,
  value,
  target,
  unit = "g",
}: {
  label: string;
  value: number;
  target: number;
  unit?: string;
}) {
  const ratio = target > 0 ? value / target : 0;
  const over = ratio > 1.05;
  const width = Math.min(Math.max(ratio, 0), 1) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="min-w-0 truncate font-semibold text-ink-soft">{label}</span>
        <span className="shrink-0 tabular-nums text-ink-faint">
          <b className="font-bold text-ink">{Math.round(value)}</b>
          {target > 0 ? ` / ${Math.round(target)}` : ""}
          {unit}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg">
        <div
          className={`h-full rounded-full ${over ? "bg-warn" : "bg-accent"}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export function MacroPanel({
  totals,
  target,
  title,
}: {
  totals: Macros;
  target: Macros;
  title?: string;
}) {
  const { t } = useI18n();
  const remaining = Math.max(0, Math.round(target.kcal - totals.kcal));
  return (
    <Card plain>
      <div className="mb-3.5 flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {title ?? t.common.macros.todayTitle}
        </p>
        {target.kcal > 0 ? (
          <p className="shrink-0 text-[12.5px] text-ink-faint">
            <b className="font-bold tabular-nums text-ink">{remaining}</b> {t.common.macros.kcalLeft}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <MacroBar label={t.common.macros.calories} value={totals.kcal} target={target.kcal} unit=" kcal" />
        <MacroBar label={t.common.macros.protein} value={totals.protein} target={target.protein} />
        <MacroBar label={t.common.macros.carbs} value={totals.carbs} target={target.carbs} />
        <MacroBar label={t.common.macros.fat} value={totals.fat} target={target.fat} />
      </div>
    </Card>
  );
}

/**
 * Weight over time. Inline SVG rather than a chart library — one series, no
 * interaction, and it keeps the client bundle free of a dependency for it.
 */
export function Sparkline({
  points,
  height = 64,
}: {
  points: { label: string; value: number }[];
  height?: number;
}) {
  const { t } = useI18n();
  if (points.length < 2) {
    return <p className="text-[13px] text-ink-faint">{t.common.charts.notEnoughData}</p>;
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 100;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p.value - min) / span) * (height - 8) - 4;
    return { x, y };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.value - first.value;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-16 w-full"
        role="img"
        aria-label={fill(t.common.charts.trendFromTo, { from: first.value, to: last.value })}
      >
        <path d={area} fill="var(--color-accent-soft)" />
        <path
          d={path}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="mt-2 flex items-baseline justify-between gap-2 text-[11.5px] tabular-nums text-ink-faint">
        <span>{first.label}</span>
        <span className={delta <= 0 ? "font-bold text-accent-ink" : "font-bold text-warn"}>
          {delta > 0 ? "+" : ""}
          {Math.round(delta * 100) / 100} kg
        </span>
        <span>{last.label}</span>
      </div>
    </div>
  );
}

/** Adherence as a labelled meter — the number plus the reason behind it. */
export function AdherenceMeter({ overall, reason }: { overall: number; reason: string }) {
  const { t } = useI18n();
  const pct = Math.round(overall * 100);
  const tone = overall >= 0.8 ? "bg-accent" : overall >= 0.5 ? "bg-warn" : "bg-risk";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{t.common.charts.thisWeek}</p>
        <p className="text-2xl font-bold tabular-nums">{pct}%</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs leading-snug text-ink-soft">{reason}</p>
    </div>
  );
}
