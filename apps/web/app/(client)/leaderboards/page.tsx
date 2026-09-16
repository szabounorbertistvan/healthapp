import Link from "next/link";
import { LEADERBOARD_METRICS, LEADERBOARD_PERIODS, LEADERBOARD_SCOPES } from "@healthapp/shared";
import { getLeaderboard, metricOf, periodOf, scopeOf } from "@/lib/leaderboard-data";
import { LeaderboardCard } from "@/components/leaderboard";
import { EmptyState } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

/**
 * /leaderboards — one board at a time: a period (this week by default) and a
 * metric (training load by default), both plain links so the page works
 * without JavaScript and every combination has a URL. The board itself is
 * one RPC: top 10 plus the viewer's own row.
 */
export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ metric?: string; period?: string; scope?: string }>;
}) {
  const { t } = await getI18n();
  const params = await searchParams;
  const metric = metricOf(params.metric);
  const period = periodOf(params.period);
  const scope = scopeOf(params.scope);
  const board = await getLeaderboard(metric, period, scope);
  const l = t.common.leaderboards;
  const href = (m: string, p: string, s: string = scope) =>
    `/leaderboards?metric=${m}&period=${p}&scope=${s}`;

  return (
    // One board at a time: a readable column, not a lonely strip on an ultrawide.
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{l.title}</h1>

      {/* Who is being ranked comes before what is ranked: a board of strangers
          and a board of the people you train with are different questions. */}
      <div className="mt-4 inline-flex gap-1 rounded-full bg-surface p-1" role="group" aria-label={l.scopeLabel}>
        {LEADERBOARD_SCOPES.map((s) => (
          <Link
            key={s}
            href={href(metric, period, s)}
            aria-current={s === scope ? "page" : undefined}
            className={`flex h-9 items-center rounded-full px-4 text-[12.5px] font-semibold ${
              s === scope ? "bg-accent text-accent-fg" : "text-ink-soft hover:text-ink"
            }`}
          >
            {l.scopes[s]}
          </Link>
        ))}
      </div>

      <div className="mt-3 inline-flex gap-1 rounded-full bg-surface p-1" role="group" aria-label={l.periodLabel}>
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
        {scope === "following" && board.entries.length === 0 ? (
          <EmptyState plain title={l.emptyFollowing} hint={l.emptyFollowingHint} />
        ) : (
          <LeaderboardCard board={board} metric={metric} period={period} />
        )}
      </div>
    </div>
  );
}
