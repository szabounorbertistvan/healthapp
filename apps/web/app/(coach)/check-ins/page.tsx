import { getCheckIns } from "@/lib/data";
import { EmptyState, PageTitle } from "@/components/ui";
import { CheckInReview } from "@/components/check-in-review";

export default async function CheckInsPage() {
  const checkIns = await getCheckIns();
  return (
    <div>
      <PageTitle title={`Check-ins to review (${checkIns.length})`} />
      {checkIns.length === 0 ? (
        <EmptyState title="All caught up" hint="New client check-ins will appear here." />
      ) : (
        <CheckInReview checkIns={checkIns} />
      )}
    </div>
  );
}
