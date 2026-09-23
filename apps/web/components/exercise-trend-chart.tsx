"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { exerciseSeries, type ExerciseMetric, type ExerciseSession } from "@healthapp/shared";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";

const HEIGHT = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

/**
 * One exercise over time: one line, one point per session, a metric switch
 * above it (best estimated 1RM, heaviest set, session volume, most reps).
 * Up is good here — unlike body weight — so nothing is coloured by direction.
 *
 * Drawn in real pixels (the width comes from a ResizeObserver) so markers stay
 * round at any width. Hover or touch shows a crosshair and the session's value;
 * the session list under the chart is the table view of the same numbers.
 */
export function ExerciseTrendChart({ sessions, bodyweight }: { sessions: ExerciseSession[]; bodyweight: boolean }) {
  const { t, locale } = useI18n();
  const d = t.clientApp.exerciseDetail;
  const u = useUnits();
  const metrics: ExerciseMetric[] = bodyweight ? ["reps"] : ["e1rm", "heaviest", "volume", "reps"];
  const [metric, setMetric] = useState<ExerciseMetric>(metrics[0]);
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isCount = metric === "reps";
  const unit = isCount ? d.repsUnit : u.weightUnit;
  const points = useMemo(
    () => exerciseSeries(sessions, metric).map((p) => ({ at: p.at, value: isCount ? p.value : u.weightValue(p.value) })),
    [sessions, metric, isCount, u],
  );
  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" });
  const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString(locale === "ro" ? "ro-RO" : "en-GB");

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const values = points.map((p) => p.value);
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  // A little headroom so the line never rides the frame; a flat series still gets a band.
  const span = rawMax - rawMin || Math.max(1, rawMax * 0.1);
  const min = Math.max(0, rawMin - span * 0.15);
  const max = rawMax + span * 0.15;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;
  const ticks = [min, (min + max) / 2, max];
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const active = hover !== null ? points[hover] : null;

  function onMove(clientX: number) {
    const el = boxRef.current;
    if (!el || points.length === 0) return;
    const px = clientX - el.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  }

  return (
    <div>
      {metrics.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={d.chartMetric}>
          {metrics.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={metric === m}
              onClick={() => { setMetric(m); setHover(null); }}
              className={`h-8 rounded-full px-3 text-[12px] font-semibold ${
                metric === m ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"
              }`}
            >
              {d.metrics[m]}
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={boxRef}
        className="relative mt-3 touch-pan-y select-none"
        style={{ height: HEIGHT }}
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        {points.length < 2 ? (
          <p className="pt-16 text-center text-[13px] text-ink-faint">{d.chartNeedsTwo}</p>
        ) : width > 0 ? (
          <svg width={width} height={HEIGHT} role="img" aria-label={`${d.metrics[metric]}: ${fmt(points[0].value)} → ${fmt(points.at(-1)!.value)} ${unit}`}>
            {ticks.map((v, i) => (
              <g key={i}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} opacity={0.6} />
                <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-faint text-[10.5px] tabular-nums">
                  {fmt(v)}
                </text>
              </g>
            ))}
            <text x={PAD.left} y={HEIGHT - 6} className="fill-ink-faint text-[10.5px]">{dateLabel(points[0].at)}</text>
            <text x={width - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-ink-faint text-[10.5px]">
              {dateLabel(points.at(-1)!.at)}
            </text>
            <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) => (
              <circle key={p.at} cx={x(i)} cy={y(p.value)} r={hover === i ? 5.5 : 4} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={2} />
            ))}
            {active && hover !== null ? (
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-ink-faint)" strokeWidth={1} strokeDasharray="3 3" />
            ) : null}
          </svg>
        ) : null}

        {active && hover !== null && width > 0 ? (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-xl bg-bg px-2.5 py-1.5 text-[11.5px] shadow-sm ring-1 ring-line"
            style={{ left: Math.min(Math.max(x(hover), 60), width - 60) }}
          >
            <span className="text-ink-faint">{dateLabel(active.at)}</span>{" "}
            <b className="tabular-nums text-ink">{fmt(active.value)} {unit}</b>
          </div>
        ) : null}
      </div>
    </div>
  );
}
