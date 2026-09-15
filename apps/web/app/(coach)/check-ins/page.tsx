import { getCheckIns } from "@/lib/data";
import { EmptyState } from "@/components/ui";
import { CheckInReview } from "@/components/check-in-review";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export default async function CheckInsPage() {
  const { t } = await getI18n();
  const checkIns = await getCheckIns();
  return (
    <div className="mx-auto max-w-[1600px]">
      <header>
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">
          {fill(t.coachApp.checkIns.title, { n: checkIns.length })}
        </h1>
      </header>
      <div className="mt-5 sm:mt-6">
        {checkIns.length === 0 ? (
          <EmptyState plain title={t.coachApp.checkIns.emptyTitle} hint={t.coachApp.checkIns.emptyHint} />
        ) : (
          <CheckInReview checkIns={checkIns} />
        )}
      </div>
    </div>
  );
}
