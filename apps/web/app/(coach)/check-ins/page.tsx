import { getCheckIns } from "@/lib/data";
import { EmptyState, PageTitle } from "@/components/ui";
import { CheckInReview } from "@/components/check-in-review";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export default async function CheckInsPage() {
  const { t } = await getI18n();
  const checkIns = await getCheckIns();
  return (
    <div>
      <PageTitle title={fill(t.coachApp.checkIns.title, { n: checkIns.length })} />
      {checkIns.length === 0 ? (
        <EmptyState title={t.coachApp.checkIns.emptyTitle} hint={t.coachApp.checkIns.emptyHint} />
      ) : (
        <CheckInReview checkIns={checkIns} />
      )}
    </div>
  );
}
