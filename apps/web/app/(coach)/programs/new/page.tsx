import Link from "next/link";
import { getRoster } from "@/lib/data";
import { Card, PageTitle } from "@/components/ui";
import { NewProgramForm } from "@/components/new-program-form";
import { getI18n } from "@/lib/i18n/server";

export default async function NewProgramPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { t } = await getI18n();
  const [roster, { client }] = await Promise.all([getRoster(), searchParams]);

  return (
    <div>
      <Link href="/programs" className="text-sm text-accent-ink hover:underline">
        {t.coachApp.programBuilderPage.back}
      </Link>
      <PageTitle title={t.coachApp.programBuilderPage.newTitle} />
      <Card>
        <NewProgramForm roster={roster} initialClientId={client} />
      </Card>
    </div>
  );
}
