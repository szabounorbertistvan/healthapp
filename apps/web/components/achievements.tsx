"use client";
// The achievements list: category filter, then one card per badge with its
// rarity, requirement and — until it is earned — the owner's progress toward
// it. Every number arrives from achievement_progress(); nothing here computes
// or sends one back.
import Link from "next/link";
import { categoriesPresent, isAchievementRarity, type AchievementCategory } from "@healthapp/shared";
import { progressText, requirementText } from "@/lib/achievement-format";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { AchievementRow } from "@/lib/types";
import { ChallengeProgressBar } from "./challenges";
import { BadgeGlyph, RarityChip } from "./social-v2";

export function AchievementFilter({ rows, active }: { rows: AchievementRow[]; active: AchievementCategory | null }) {
  const { t } = useI18n();
  const a = t.common.achievements;
  const chip = (href: string, label: string, on: boolean) => (
    <Link
      key={href}
      href={href}
      scroll={false}
      aria-current={on ? "page" : undefined}
      className={`inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-[12.5px] font-semibold ${
        on ? "bg-ink text-bg" : "bg-surface text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {chip("/achievements", a.all, active === null)}
      {categoriesPresent(rows).map((c) => chip(`/achievements?c=${c}`, a.categories[c], active === c))}
    </nav>
  );
}

export function AchievementGrid({ rows }: { rows: AchievementRow[] }) {
  const { t } = useI18n();
  if (rows.length === 0) {
    return <p className="text-[13px] text-ink-faint">{t.common.achievements.noneInCategory}</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {rows.map((r) => (
        <li key={r.slug}>
          <AchievementCard row={r} />
        </li>
      ))}
    </ul>
  );
}

function AchievementCard({ row }: { row: AchievementRow }) {
  const { t, locale } = useI18n();
  const a = t.common.achievements;
  const earned = row.awarded_at !== null;
  const p = progressText(a, row.metric, row.current_value, row.target, locale);
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <Link
      href={`/achievements/${row.slug}`}
      className="flex h-full gap-3 rounded-2xl bg-surface px-3.5 py-3.5 transition-colors hover:bg-bg"
    >
      <span
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${
          earned ? "bg-accent text-accent-fg" : "bg-bg text-ink-faint"
        }`}
      >
        <BadgeGlyph icon={row.icon} className="h-5 w-5 [stroke-width:2.1]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className={`text-[13.5px] font-semibold leading-snug ${earned ? "" : "text-ink-soft"}`}>
            {locale === "ro" ? row.name_ro : row.name_en}
          </span>
          {isAchievementRarity(row.rarity) ? <RarityChip rarity={row.rarity} label={a.rarities[row.rarity]} /> : null}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-faint">
          {requirementText(a, row.metric, row.target, locale)}
        </span>
        {earned ? (
          <span className="mt-2 block text-[11.5px] font-semibold text-accent-ink">
            {fill(a.earnedOn, { date: df.format(new Date(row.awarded_at!)) })}
          </span>
        ) : row.target > 1 ? (
          <span className="mt-2 block">
            <ChallengeProgressBar pct={p.percent} completed={false} />
            <span className="mt-1 flex justify-between gap-2 text-[11.5px] tabular-nums text-ink-faint">
              <span>{p.line}</span>
              <span>{p.percent}%</span>
            </span>
          </span>
        ) : (
          <span className="mt-2 block text-[11.5px] text-ink-faint">{a.notEarned}</span>
        )}
      </span>
    </Link>
  );
}
