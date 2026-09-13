import Link from "next/link";
import { getMyStreak } from "@/lib/streak-data";
import { EmptyState, PageTitle } from "@/components/ui";
import { MilestoneList, StreakCard } from "@/components/streak";
import { getI18n } from "@/lib/i18n/server";

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
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle title={`🔥 ${s.title}`}>
        <Link href="/today" className="text-xs font-semibold text-ink-faint hover:text-accent-ink">
          ← {t.common.nav.today}
        </Link>
      </PageTitle>
      <StreakCard view={view} />
      <MilestoneList view={view} />
    </div>
  );
}
