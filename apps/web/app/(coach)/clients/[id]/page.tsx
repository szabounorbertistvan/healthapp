import Link from "next/link";
import { notFound } from "next/navigation";
import { getClients } from "@/lib/data";
import { getClientWeeklySummary, type WeekChoice } from "@/lib/weekly-data";
import { getClientFitnessScore } from "@/lib/fitness-score-data";
import { SignalBadge } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { WeeklySummaryCard } from "@/components/weekly-summary";
import { FitnessScoreCoachCard } from "@/components/fitness-score";
import { getI18n } from "@/lib/i18n/server";

/**
 * One client, from the coach's side: their weekly summary and 28-day fitness
 * score. Every number is
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
  const choice: WeekChoice = week === "previous" ? "previous" : "current";
  // The roster and the summary go out together: the summary is filtered by
  // client id and RLS answers it, so it never needed the roster first. A client
  // the coach cannot see still 404s below — the wasted summary read is empty.
  const [clients, summary, fitness] = await Promise.all([
    getClients(),
    getClientWeeklySummary(id, choice),
    getClientFitnessScore(id),
  ]);
  const client = clients.find((c) => c.client_id === id && c.status === "active");
  if (!client) notFound();

  return (
    // One client's report: a readable column, not the full desk width.
    <div className="mx-auto max-w-3xl">
      <Link
        href="/clients"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={ICON.back} className="h-[15px] w-[15px]" />
        {t.common.nav.clients}
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
            {client.full_name}
          </h1>
          <SignalBadge signal={client.signal} />
        </div>
        {/* The roster page has a generic "new program" button with a client
            picker; from here the client is already known, so it rides on the
            query string and the form opens with them selected. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/programs/new?client=${id}`}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
          >
            {t.coachApp.programs.newProgram}
          </Link>
          <Link
            href={`/nutrition/new?client=${id}`}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
          >
            {t.coachApp.nutrition.newPlan}
          </Link>
        </div>
      </div>

      <div className="mt-4 space-y-4 sm:mt-6">
        <FitnessScoreCoachCard view={fitness} />
        {summary ? (
          <WeeklySummaryCard summary={summary} switchPath={`/clients/${id}`} />
        ) : (
          <p className="text-[13px] text-ink-faint">{t.common.weekly.noData}</p>
        )}
      </div>
    </div>
  );
}

/** The 24-box icon paths this screen uses. */
const ICON = {
  back: "m15 6-6 6 6 6",
} as const;
