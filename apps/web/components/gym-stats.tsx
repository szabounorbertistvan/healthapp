"use client";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setHomeGym } from "@/app/gym-actions";
import type { GymPin } from "@/lib/gym-data";
import { useI18n } from "@/lib/i18n/client";

/** MapLibre touches `window` on import: the map renders in the browser only. */
export const GymMapLoader = dynamic<{ pins: GymPin[]; homeGymId: string | null }>(
  () => import("./gym-map").then((m) => m.GymMap),
  { ssr: false, loading: () => <div className="h-[clamp(320px,62vh,720px)] w-full animate-pulse rounded-3xl bg-surface" /> },
);

/**
 * One series of counts as thin bars (busiest hours, busiest weekdays): one
 * hue, no legend — the heading names it — a value label on the peak only, a
 * native tooltip per bar, and the same numbers as a list for screen readers.
 */
export function CountBars({ values, labels, every = 1, caption }: {
  values: number[];
  labels: string[];
  /** Show every n-th tick label (24 hours do not fit under a phone). */
  every?: number;
  caption: string;
}) {
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  return (
    <figure>
      <div className="flex h-28 items-end gap-[2px]" aria-hidden>
        {values.map((v, i) => (
          <div key={i} className="relative flex h-full flex-1 flex-col justify-end" title={`${labels[i]}: ${v}`}>
            {i === peak && v > 0 ? (
              <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full text-[10.5px] font-semibold tabular-nums text-ink-soft">
                {v}
              </span>
            ) : null}
            <div
              className={`w-full rounded-t-[4px] ${v > 0 ? "bg-accent" : "bg-line"}`}
              style={{ height: v > 0 ? `${Math.max(4, (v / max) * 100)}%` : "2px" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10.5px] text-ink-faint" aria-hidden>
        {labels.map((l, i) => (
          <span key={i} className="flex-1 text-center tabular-nums">{i % every === 0 ? l : ""}</span>
        ))}
      </div>
      <figcaption className="mt-1 text-[11.5px] text-ink-faint">{caption}</figcaption>
      <ul className="sr-only">
        {values.map((v, i) => <li key={i}>{labels[i]}: {v}</li>)}
      </ul>
    </figure>
  );
}

/** "Make it my gym" on a gym's page; the board opt-in stays on /account. */
export function SetHomeGymButton({ gymId, isHome }: { gymId: string; isHome: boolean }) {
  const { t } = useI18n();
  const s = t.gyms.stats;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [failed, setFailed] = useState(false);
  if (isHome) {
    return <span className="inline-flex h-10 items-center rounded-full bg-accent-soft px-4 text-[13px] font-semibold text-accent-ink">{s.isHome}</span>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => start(async () => {
          const r = await setHomeGym(gymId, false);
          setFailed(!r.ok);
          router.refresh();
        })}
        className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-[13px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
      >
        {s.setHome}
      </button>
      {failed ? <span className="text-[12.5px] text-risk">{t.gyms.errors.generic}</span> : null}
    </span>
  );
}
