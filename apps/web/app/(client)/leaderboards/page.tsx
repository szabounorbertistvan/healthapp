import Link from "next/link";
import { LEADERBOARD_METRICS, LEADERBOARD_PERIODS } from "@healthapp/shared";
import { getLeaderboard, metricOf, periodOf } from "@/lib/leaderboard-data";
import { LeaderboardCard } from "@/components/leaderboard";
import { PageTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

/**
 * /leaderboards — one board at a time: a period (this week by default) and a
 * metric (training load by default), both plain links so the page works
 * without JavaScript and every combination has a URL. The board itself is
 * one RPC: top 10 plus the viewer's own row.
 */
export default async function LeaderboardsPage({ searchParams }: { searchParams: Promise<{ metric?: string; period?: string }> }) {
  const { t } = await getI18n();
  const params = await searchParams;
  const metric = metricOf(params.metric);
  const period = periodOf(params.period);
  const board = await getLeaderboard(metric, period);
  const l = t.common.leaderboards;
  const href = (m: string, p: string) => `/leaderboards?metric=${m}&period=${p}`;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle title={`🏆 ${l.title}`} />

      <div className="inline-flex overflow-hidden rounded-lg border border-line text-xs font-semibold" role="group" aria-label={l.periodLabel}>
        {LEADERBOARD_PERIODS.map((p) => (
          <Link
            key={p}
            href={href(metric, p)}
            aria-current={p === period ? "page" : undefined}
            className={`min-h-9 px-3 py-2 ${p === period ? "bg-accent text-accent-fg" : "text-ink-soft hover:text-ink"}`}
          >
            {l.periods[p]}
          </Link>
        ))}
      </div>

      <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label={l.title}>
        {LEADERBOARD_METRICS.map((m) => (
          <Link
            key={m}
            href={href(m, period)}
            aria-current={m === metric ? "page" : undefined}
            className={`min-h-9 shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold ${
              m === metric ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-ink-soft hover:border-accent"
            }`}
          >
            {l.metrics[m]}
          </Link>
        ))}
      </nav>

      <LeaderboardCard board={board} metric={metric} period={period} />
    </div>
  );
}
