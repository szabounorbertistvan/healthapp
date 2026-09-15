import Link from "next/link";
import { getMyStreak } from "@/lib/streak-data";
import { EmptyState } from "@/components/ui";
import { MilestoneList, StreakCard } from "@/components/streak";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const BACK = "m15 6-6 6 6 6";

/**
 * The streak page: the card with the 12-week calendar, and every milestone
 * reached with the choice to share the ones worth sharing. All of it is
 * derived from completed sessions on the way in — nothing to edit here.
 */
export default async function StreakPage() {
  const { t } = await getI18n();
  const view = await getMyStreak();
  if (!view) return <EmptyState title={t.clientApp.today.notSignedInTitle} hint={t.clientApp.today.notSignedInHint} />;
  const s = t.common.streaks;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/today"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {t.common.nav.today}
      </Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{s.title}</h1>
      <div className="mt-5 space-y-4 sm:mt-6">
        <StreakCard view={view} />
        <MilestoneList view={view} />
      </div>
    </div>
  );
}
