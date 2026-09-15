import Link from "next/link";
import { LEADERBOARD_METRICS, LEADERBOARD_PERIODS } from "@healthapp/shared";
import { getLeaderboard, metricOf, periodOf } from "@/lib/leaderboard-data";
import { LeaderboardCard } from "@/components/leaderboard";
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
    // One board at a time: a readable column, not a lonely strip on an ultrawide.
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{l.title}</h1>

      <div className="mt-4 inline-flex gap-1 rounded-full bg-surface p-1" role="group" aria-label={l.periodLabel}>
        {LEADERBOARD_PERIODS.map((p) => (
          <Link
            key={p}
            href={href(metric, p)}
            aria-current={p === period ? "page" : undefined}
            className={`flex h-9 items-center rounded-full px-4 text-[12.5px] font-semibold ${
              p === period ? "bg-accent text-accent-fg" : "text-ink-soft hover:text-ink"
            }`}
          >
            {l.periods[p]}
          </Link>
        ))}
      </div>

      <nav className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" aria-label={l.title}>
        {LEADERBOARD_METRICS.map((m) => (
          <Link
            key={m}
            href={href(m, period)}
            aria-current={m === metric ? "page" : undefined}
            className={`flex h-9 shrink-0 items-center rounded-full px-4 text-[12.5px] font-semibold ${
              m === metric ? "bg-accent-soft text-accent-ink" : "bg-surface text-ink-soft hover:text-ink"
            }`}
          >
            {l.metrics[m]}
          </Link>
        ))}
      </nav>

      <div className="mt-4">
        <LeaderboardCard board={board} metric={metric} period={period} />
      </div>
    </div>
  );
}
