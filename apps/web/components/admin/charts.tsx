// Server-rendered SVG charts for the admin pages. No library: the app already
// draws its training-load bars inline (components/training-load.tsx), and a
// daily series needs nothing more than bars and a line. Colors are the theme
// tokens via currentColor / CSS variables, so both themes work.
import type { Locale } from "@/lib/i18n";

export type SeriesPoint = { day: string; value: number };

function shortDay(iso: string, locale: Locale): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** One metric per day as bars, with a few date ticks and the max on the axis. */
export function DailyBars({ title, points, locale, accent = false }: { title: string; points: SeriesPoint[]; locale: Locale; accent?: boolean }) {
  const w = 600, h = 160, padL = 28, padB = 22, padT = 8;
  const n = Math.max(1, points.length);
  const max = Math.max(1, ...points.map((p) => p.value));
  const slot = (w - padL) / n;
  const bw = Math.max(2, slot * 0.7);
  const total = points.reduce((s, p) => s + p.value, 0);
  const tickEvery = n > 45 ? 15 : n > 20 ? 7 : n > 10 ? 3 : 1;
  return (
    <figure className="glass glass--subtle rounded-2xl p-3.5">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</span>
        <span className="font-display text-[15px] font-extrabold tabular-nums">{total.toLocaleString(locale)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label={title}>
        <line x1={padL} x2={w} y1={h - padB} y2={h - padB} stroke="currentColor" className="text-line" strokeWidth="1" />
        <text x={padL - 4} y={padT + 8} textAnchor="end" className="fill-current text-ink-faint" fontSize="9">{max}</text>
        <text x={padL - 4} y={h - padB} textAnchor="end" className="fill-current text-ink-faint" fontSize="9">0</text>
        {points.map((p, i) => {
          const bh = ((h - padB - padT) * p.value) / max;
          const x = padL + i * slot + (slot - bw) / 2;
          return (
            <g key={p.day}>
              <rect x={x} y={h - padB - bh} width={bw} height={bh} rx={1.5} className={accent ? "fill-accent" : "fill-accent-ink"} opacity={p.value === 0 ? 0.15 : 0.85}>
                <title>{`${shortDay(p.day, locale)}: ${p.value}`}</title>
              </rect>
              {i % tickEvery === 0 ? (
                <text x={x + bw / 2} y={h - 6} textAnchor="middle" className="fill-current text-ink-faint" fontSize="9">{shortDay(p.day, locale)}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Two or three series as lines over the same days. */
export function DailyLines({ title, series, locale }: { title: string; series: { label: string; points: SeriesPoint[]; tone: "accent" | "ink" | "warn" }[]; locale: Locale }) {
  const w = 600, h = 160, padL = 28, padB = 22, padT = 8;
  const days = series[0]?.points.map((p) => p.day) ?? [];
  const n = Math.max(1, days.length);
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const x = (i: number) => padL + (n === 1 ? 0 : (i * (w - padL)) / (n - 1));
  const y = (v: number) => h - padB - ((h - padB - padT) * v) / max;
  const tickEvery = n > 45 ? 15 : n > 20 ? 7 : n > 10 ? 3 : 1;
  const stroke = { accent: "stroke-accent", ink: "stroke-ink-soft", warn: "stroke-warn" };
  const dot = { accent: "bg-accent", ink: "bg-ink-soft", warn: "bg-warn" };
  return (
    <figure className="glass glass--subtle rounded-2xl p-3.5">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</span>
        <span className="flex flex-wrap gap-3 text-[11px] text-ink-soft">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${dot[s.tone]}`} />{s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label={title}>
        <line x1={padL} x2={w} y1={h - padB} y2={h - padB} stroke="currentColor" className="text-line" strokeWidth="1" />
        <text x={padL - 4} y={padT + 8} textAnchor="end" className="fill-current text-ink-faint" fontSize="9">{max}</text>
        <text x={padL - 4} y={h - padB} textAnchor="end" className="fill-current text-ink-faint" fontSize="9">0</text>
        {days.map((d, i) => (i % tickEvery === 0 ? (
          <text key={d} x={x(i)} y={h - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-current text-ink-faint" fontSize="9">{shortDay(d, locale)}</text>
        ) : null))}
        {series.map((s) => (
          <polyline key={s.label} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className={stroke[s.tone]}
            points={s.points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
        ))}
      </svg>
    </figure>
  );
}

/** Small weight-over-time line for the user page. */
export function WeightLine({ points, locale, unit }: { points: { date: string; kg: number }[]; locale: Locale; unit: string }) {
  if (points.length < 2) return null;
  const w = 600, h = 120, padL = 34, padB = 18, padT = 8;
  const vals = points.map((p) => Number(p.kg));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(1, hi - lo);
  const x = (i: number) => padL + (i * (w - padL - 4)) / (points.length - 1);
  const y = (v: number) => h - padB - ((h - padB - padT) * (v - lo)) / span;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-28 w-full" role="img">
      <text x={padL - 4} y={padT + 8} textAnchor="end" className="fill-current text-ink-faint" fontSize="9">{hi} {unit}</text>
      <text x={padL - 4} y={h - padB} textAnchor="end" className="fill-current text-ink-faint" fontSize="9">{lo} {unit}</text>
      <text x={padL} y={h - 4} className="fill-current text-ink-faint" fontSize="9">{shortDay(points[0].date, locale)}</text>
      <text x={w - 4} y={h - 4} textAnchor="end" className="fill-current text-ink-faint" fontSize="9">{shortDay(points[points.length - 1].date, locale)}</text>
      <polyline fill="none" strokeWidth="2" strokeLinejoin="round" className="stroke-accent" points={points.map((p, i) => `${x(i)},${y(Number(p.kg))}`).join(" ")} />
    </svg>
  );
}
