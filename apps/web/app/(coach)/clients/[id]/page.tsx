import Link from "next/link";
import { notFound } from "next/navigation";
import { getClients } from "@/lib/data";
import { getClientWeeklySummary, type WeekChoice } from "@/lib/weekly-data";
import { PageTitle, SignalBadge } from "@/components/ui";
import { WeeklySummaryCard } from "@/components/weekly-summary";
import { getI18n } from "@/lib/i18n/server";

/**
 * One client, from the coach's side: their weekly summary. Every number is
 * read under RLS — a coach sees exactly what is_active_coach_of() allows —
 * and computed by the same code the client's own Today uses.
 */
export default async function CoachClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { t } = await getI18n();
  const [{ id }, { week }] = await Promise.all([params, searchParams]);
  const client = (await getClients()).find((c) => c.client_id === id && c.status === "active");
  if (!client) notFound();
  const choice: WeekChoice = week === "previous" ? "previous" : "current";
  const summary = await getClientWeeklySummary(id, choice);

  return (
    <div className="space-y-4">
      <Link href="/clients" className="text-xs font-semibold text-ink-faint hover:text-accent-ink">
        ← {t.common.nav.clients}
      </Link>
      <PageTitle title={client.full_name}>
        <SignalBadge signal={client.signal} />
      </PageTitle>
      {summary ? (
        <WeeklySummaryCard summary={summary} switchPath={`/clients/${id}`} />
      ) : (
        <p className="text-sm text-ink-faint">{t.common.weekly.noData}</p>
      )}
    </div>
  );
}
