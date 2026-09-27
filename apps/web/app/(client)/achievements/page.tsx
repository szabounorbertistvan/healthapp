import Link from "next/link";
import { isAchievementCategory, summarizeAchievements } from "@healthapp/shared";
import { getMyAchievements } from "@/lib/achievements-data";
import { currentActorId } from "@/lib/actor";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { EmptyState } from "@/components/ui";
import { AchievementFilter, AchievementGrid } from "@/components/achievements";
import { NavIcon } from "@/components/client-nav";

const BACK = "m15 6-6 6 6 6";

/**
 * Every achievement with the signed-in person's own progress. One RPC call
 * (achievement_progress) computes all of it in the database; the category
 * filter is a query parameter, so it is a plain link and costs no extra read.
 * Earned first within the order of the catalog, so what is left reads as a list
 * of next steps.
 */
export default async function AchievementsPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { t } = await getI18n();
  const [me, rows, query] = await Promise.all([currentActorId(), getMyAchievements(), searchParams]);
  if (!me) return <EmptyState title={t.clientApp.today.notSignedInTitle} hint={t.clientApp.today.notSignedInHint} />;
  const a = t.common.achievements;
  const category = isAchievementCategory(query.c) ? query.c : null;
  const summary = summarizeAchievements(rows.map((r) => ({ ...r, earned: r.awarded_at !== null })));
  const shown = rows
    .filter((r) => category === null || r.category === category)
    .sort((x, y) => Number(y.awarded_at !== null) - Number(x.awarded_at !== null) || x.sort - y.sort);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/people/${me}#achievements`}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {a.backToProfile}
      </Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{a.title}</h1>
      <p className="mt-1 text-[13px] text-ink-soft">{a.subtitle}</p>
      <p className="mt-3 text-sm font-semibold tabular-nums">
        {fill(a.earnedOf, { earned: summary.earned, total: summary.total })}
      </p>
      <div className="mt-4">
        <AchievementFilter rows={rows} active={category} />
      </div>
      <div className="mt-4">
        <AchievementGrid rows={shown} />
      </div>
    </div>
  );
}
