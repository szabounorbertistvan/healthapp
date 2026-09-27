import Link from "next/link";
import { notFound } from "next/navigation";
import { isAchievementCategory, isAchievementRarity } from "@healthapp/shared";
import { getMyAchievements } from "@/lib/achievements-data";
import { metricExplanation, progressText, requirementText } from "@/lib/achievement-format";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { Card } from "@/components/ui";
import { BadgeGlyph, RarityChip, ShareBadge } from "@/components/social-v2";
import { ChallengeProgressBar } from "@/components/challenges";
import { NavIcon } from "@/components/client-nav";

const BACK = "m15 6-6 6 6 6";

/**
 * One achievement, for its owner: the requirement, how the metric is counted,
 * the owner's progress, the date it was earned, and — once earned — sharing.
 * Read from the same achievement_progress() call as the list (cached per
 * request); a slug outside the catalog is a 404. Only catalog text and the
 * person's own numbers are shown — no ids, no other people's data.
 */
export default async function AchievementPage({ params }: { params: Promise<{ slug: string }> }) {
  const { t, locale } = await getI18n();
  const [{ slug }, rows] = await Promise.all([params, getMyAchievements()]);
  const row = rows.find((r) => r.slug === slug);
  if (!row) notFound();

  const a = t.common.achievements;
  const earned = row.awarded_at !== null;
  const p = progressText(a, row.metric, row.current_value, row.target, locale);
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  const name = locale === "ro" ? row.name_ro : row.name_en;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/achievements"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {a.title}
      </Link>

      <Card plain className="mt-4">
        <div className="flex items-center gap-4">
          <span
            className={`grid h-16 w-16 shrink-0 place-items-center rounded-full ${
              earned ? "bg-accent text-accent-fg" : "bg-bg text-ink-faint"
            }`}
          >
            <BadgeGlyph icon={row.icon} className="h-8 w-8 [stroke-width:1.9]" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">{name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {isAchievementRarity(row.rarity) ? <RarityChip rarity={row.rarity} label={a.rarities[row.rarity]} /> : null}
              {isAchievementCategory(row.category) ? (
                <span className="inline-flex rounded-full bg-bg px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-ink-soft">
                  {a.categories[row.category]}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <dl className="mt-5 space-y-4 text-[13.5px]">
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-soft">{a.requirementLabel}</dt>
            <dd className="mt-1">{requirementText(a, row.metric, row.target, locale)}</dd>
          </div>

          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-soft">{a.progressLabel}</dt>
            <dd className="mt-1.5">
              <ChallengeProgressBar pct={p.percent} completed={earned} height="h-2.5" />
              <div className="mt-1.5 flex justify-between gap-2 tabular-nums">
                <span className="font-semibold">{p.line}</span>
                <span className="text-ink-soft">{p.percent}%</span>
              </div>
              {!earned && p.remainingLine ? <p className="mt-0.5 text-[12px] text-ink-faint">{p.remainingLine}</p> : null}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-soft">{a.earnedLabel}</dt>
            <dd className="mt-1">
              {earned ? fill(a.earnedOn, { date: df.format(new Date(row.awarded_at!)) }) : a.notEarned}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-soft">{a.howCounted}</dt>
            <dd className="mt-1 text-ink-soft">{metricExplanation(a, row.metric)}</dd>
          </div>
        </dl>

        {earned ? (
          <div className="mt-5 flex justify-end">
            <ShareBadge
              slug={row.slug}
              shared={row.shared}
              label={t.common.social.shareAchievement}
              doneLabel={t.common.social.achievementShared}
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
