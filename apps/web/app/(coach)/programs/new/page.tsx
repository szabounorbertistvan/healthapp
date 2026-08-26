import Link from "next/link";
import { getRoster } from "@/lib/data";
import { Card, PageTitle } from "@/components/ui";
import { NewProgramForm } from "@/components/new-program-form";
import { getI18n } from "@/lib/i18n/server";

export default async function NewProgramPage() {
  const { t } = await getI18n();
  const roster = await getRoster();

  return (
    <div>
      <Link href="/programs" className="text-sm text-accent-ink hover:underline">
        {t.coachApp.programBuilderPage.back}
      </Link>
      <PageTitle title={t.coachApp.programBuilderPage.newTitle} />
      <Card>
        <NewProgramForm roster={roster} />
      </Card>
    </div>
  );
}
