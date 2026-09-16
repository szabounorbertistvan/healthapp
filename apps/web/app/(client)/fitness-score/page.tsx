import Link from "next/link";
import { getMyFitnessScore } from "@/lib/fitness-score-data";
import { EmptyState } from "@/components/ui";
import { FitnessScoreDetail } from "@/components/fitness-score";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const BACK = "m15 6-6 6 6 6";

/**
 * The fitness score page: the number, the trend against the 28 days before,
 * each component with the count behind it and its weight, and how the score
 * is put together. Derived from completed sessions on the way in — nothing
 * to edit here.
 */
export default async function FitnessScorePage() {
  const { t } = await getI18n();
  const view = await getMyFitnessScore();
  if (!view) return <EmptyState title={t.clientApp.today.notSignedInTitle} hint={t.clientApp.today.notSignedInHint} />;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/today"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {t.common.nav.today}
      </Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{t.common.fitnessScore.title}</h1>
      <div className="mt-5 sm:mt-6">
        <FitnessScoreDetail view={view} />
      </div>
    </div>
  );
}
