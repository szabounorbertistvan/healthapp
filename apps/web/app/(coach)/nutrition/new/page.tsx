import Link from "next/link";
import { getRoster } from "@/lib/data";
import { Card } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { NewPlanForm } from "@/components/new-plan-form";
import { getI18n } from "@/lib/i18n/server";

export default async function NewPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { t } = await getI18n();
  const [roster, { client }] = await Promise.all([getRoster(), searchParams]);
  // The back label ships with its own arrow glyph; the chevron icon replaces it.
  return (
    // One form: a readable column rather than a page-wide sprawl.
    <div className="mx-auto max-w-3xl">
      <Link
        href="/nutrition"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-accent-ink"
      >
        <NavIcon d="m15 6-6 6 6 6" className="h-3.5 w-3.5" />
        {t.coachApp.nutrition.back}
      </Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
        {t.coachApp.nutrition.newTitle}
      </h1>
      <Card plain className="mt-5 sm:mt-6 sm:p-5">
        <NewPlanForm roster={roster} initialClientId={client} />
      </Card>
    </div>
  );
}
