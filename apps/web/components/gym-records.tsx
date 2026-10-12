import Link from "next/link";
import { formatWeight, relevantOneRm, type WeightUnit } from "@healthapp/shared";
import {
  GYM_RECORD_KINDS, GYM_RECORD_PERIODS, type GymRecordKind, type GymRecordLift, type GymRecordPeriod, type GymRecordRow,
} from "@/lib/gym-data";
import type { Dictionary, Locale } from "@/lib/i18n";
import { fill } from "@/lib/i18n";
import { Avatar } from "./social";
import { Card } from "./ui";

/**
 * "Gym records" on /gyms/[id]: per lift, each listed person's best at this
 * gym, ranked by estimated 1RM or by the heaviest weight moved. All state is
 * in the URL (lift, kind, period) so every board has a link. The number is
 * relevantOneRm() — the Progress page's rule — computed from the set the RPC
 * returns; the set itself ("100 kg × 3") is always shown beside it.
 */
export function GymRecords({
  gymId, lifts, rows, lift, kind, period, onBoards, unit, locale, t,
}: {
  gymId: string;
  lifts: GymRecordLift[];
  rows: GymRecordRow[];
  lift: string | null;
  kind: GymRecordKind;
  period: GymRecordPeriod;
  onBoards: boolean;
  unit: WeightUnit;
  locale: Locale;
  t: Dictionary["gyms"]["records"];
}) {
  const href = (patch: Partial<{ lift: string; kind: string; period: string }>) => {
    const q = new URLSearchParams({
      ...(lift ? { lift } : {}), kind, period, ...patch,
    });
    return `/gyms/${gymId}?${q.toString()}#records`;
  };
  const tab = (active: boolean) =>
    `flex h-9 items-center rounded-full px-4 text-[12.5px] font-semibold ${active ? "bg-accent text-accent-fg" : "text-ink-soft hover:text-ink"}`;
  const chip = (active: boolean) =>
    `flex h-9 shrink-0 items-center rounded-full px-4 text-[12.5px] font-semibold ${active ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-soft hover:text-ink"}`;
  const kg = (v: number) => formatWeight(v, unit, { locale });
  const valueOf = (r: GymRecordRow) => (kind === "weight" ? r.weight_kg : relevantOneRm(r.weight_kg, r.reps) ?? r.weight_kg);
  const exerciseName = (l: GymRecordLift) => (locale === "ro" ? l.name_ro || l.name_en : l.name_en);

  return (
    <Card plain>
      <div id="records" className="scroll-mt-20">
        <p className="font-display text-lg font-bold tracking-tight">{t.title}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-faint">{t.intro}</p>
      </div>

      {!onBoards ? (
        <div className="mt-3 rounded-2xl bg-bg px-4 py-3">
          <p className="text-[13.5px] font-semibold">{t.optInTitle}</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-faint">{t.optInHint}</p>
          <Link href="/account" className="mt-2 inline-block text-[12.5px] font-semibold text-accent-ink hover:underline">{t.optIn} →</Link>
        </div>
      ) : null}

      {lifts.length === 0 && onBoards ? (
        <p className="mt-3 text-[13px] text-ink-soft">{t.noLifts}</p>
      ) : null}

      {lifts.length > 0 ? (
        <nav className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" aria-label={t.title}>
          {lifts.map((l) => (
            <Link key={l.exercise_id} href={href({ lift: l.exercise_id })} aria-current={l.exercise_id === lift ? "page" : undefined}
              className={chip(l.exercise_id === lift)}>
              {exerciseName(l)}
            </Link>
          ))}
        </nav>
      ) : null}

      {lift ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="inline-flex gap-1 rounded-full bg-bg p-1" role="group" aria-label={t.kindLabel}>
              {GYM_RECORD_KINDS.map((k) => (
                <Link key={k} href={href({ kind: k })} aria-current={k === kind ? "page" : undefined} className={tab(k === kind)}>{t.kinds[k]}</Link>
              ))}
            </div>
            <div className="inline-flex gap-1 rounded-full bg-bg p-1" role="group" aria-label={t.periodLabel}>
              {GYM_RECORD_PERIODS.map((p) => (
                <Link key={p} href={href({ period: p })} aria-current={p === period ? "page" : undefined} className={tab(p === period)}>{t.periods[p]}</Link>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="mt-3 text-[13px] text-ink-soft">{t.empty}</p>
          ) : (
            <ol className="mt-3 grid gap-1.5">
              {rows.map((r) => (
                <li key={r.user_id}
                  className={`flex items-center gap-3 rounded-2xl px-3.5 py-2.5 ${r.is_me ? "bg-accent-soft/50" : "bg-bg"}`}>
                  <span className={`w-7 shrink-0 text-center font-display text-[16px] font-extrabold tabular-nums ${r.rank <= 3 ? "text-accent-ink" : "text-ink-faint"}`}>
                    {r.rank}
                  </span>
                  <Avatar name={r.display_name} url={r.avatar_url} size="h-9 w-9" />
                  <span className="min-w-0 flex-1">
                    {r.is_me ? (
                      <span className="block truncate text-[14px] font-semibold">{t.you}</span>
                    ) : (
                      <Link href={`/people/${r.user_id}`} className="block truncate text-[14px] font-semibold hover:underline">{r.display_name}</Link>
                    )}
                    <span className="block text-[12px] text-ink-faint tabular-nums">
                      {fill(t.set, { w: kg(r.weight_kg), r: r.reps })} · {new Date(r.achieved_at).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </span>
                  <span className="shrink-0 font-display text-[17px] font-bold tabular-nums">{kg(valueOf(r))}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">{t.howItCounts}</p>
    </Card>
  );
}
