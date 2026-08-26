import Link from "next/link";
import { getRoster } from "@/lib/data";
import { Card, PageTitle } from "@/components/ui";
import { NewPlanForm } from "@/components/new-plan-form";
import { getI18n } from "@/lib/i18n/server";

export default async function NewPlanPage() {
  const { t } = await getI18n();
  const roster = await getRoster();
  return (
    <div>
      <Link href="/nutrition" className="text-sm text-accent-ink hover:underline">
        {t.coachApp.nutrition.back}
      </Link>
      <PageTitle title={t.coachApp.nutrition.newTitle} />
      <Card>
        <NewPlanForm roster={roster} />
      </Card>
    </div>
  );
}
