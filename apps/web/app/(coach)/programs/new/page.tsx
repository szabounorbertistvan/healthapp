import Link from "next/link";
import { getRoster } from "@/lib/data";
import { Card } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { NewProgramForm } from "@/components/new-program-form";
import { getI18n } from "@/lib/i18n/server";

export default async function NewProgramPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { t } = await getI18n();
  const [roster, { client }] = await Promise.all([getRoster(), searchParams]);

  // One form, so a readable column rather than the full coach desk width.
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/programs"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d="m15 6-6 6 6 6" className="h-[15px] w-[15px]" />
        {t.coachApp.programBuilderPage.back}
      </Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
        {t.coachApp.programBuilderPage.newTitle}
      </h1>
      <Card plain className="mt-5 sm:mt-6 sm:p-5">
        <NewProgramForm roster={roster} initialClientId={client} />
      </Card>
    </div>
  );
}
