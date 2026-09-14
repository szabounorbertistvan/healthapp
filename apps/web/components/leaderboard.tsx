import Link from "next/link";
import type { Leaderboard, LeaderboardMetric, LeaderboardPeriod, LeaderboardRow } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { Avatar } from "./social";
import { Card } from "./ui";

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function formatScore(score: number, locale: string): string {
  return score.toLocaleString(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 0 });
}

/**
 * One board: title, period, the top rows and — under a rule — the viewer's
 * own row when they rank below the top. Rows are links to the public
 * profile. A list, not a table: three columns must read on a 375px phone.
 */
export async function LeaderboardCard({
  board,
  metric,
  period,
}: {
  board: Leaderboard;
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
}) {
  const { t, locale } = await getI18n();
  const l = t.common.leaderboards;
  const unit = l.units[metric];
  const meBelow = board.me !== null && !board.entries.some((r) => r.is_current_user);

  const row = (r: LeaderboardRow) => (
    <li key={r.user_id}>
      <Link
        href={`/people/${r.user_id}`}
        className={`flex min-h-12 items-center gap-3 rounded-lg px-2 py-1.5 ${
          r.is_current_user ? "border border-accent bg-accent-soft" : "hover:bg-bg"
        }`}
        aria-current={r.is_current_user ? "true" : undefined}
      >
        <span className="w-8 shrink-0 text-center text-sm font-bold tabular-nums" aria-label={`${l.rank} ${r.rank}`}>
          {MEDALS[r.rank] ?? r.rank}
        </span>
        <Avatar name={r.display_name} url={r.avatar_url} size="h-8 w-8" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {r.display_name}
          {r.is_current_user ? <span className="ml-1.5 text-[11px] font-semibold uppercase text-accent-ink">{l.you}</span> : null}
        </span>
        <span className="shrink-0 text-sm font-bold tabular-nums">
          {formatScore(r.score, locale)}
          {unit ? <span className="ml-1 text-[11px] font-normal text-ink-faint">{unit}</span> : null}
        </span>
      </Link>
    </li>
  );

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-base font-bold">🏆 {l.metrics[metric]}</p>
        <p className="text-xs text-ink-faint">{l.periods[period]}</p>
      </div>
      {board.entries.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-ink-soft">{l.emptyBoard}</p>
      ) : (
        <ul className="mt-3 space-y-0.5">
          {board.entries.map(row)}
          {meBelow && board.me ? (
            <>
              <li aria-hidden className="py-1 text-center text-xs text-ink-faint">···</li>
              {row(board.me)}
            </>
          ) : null}
        </ul>
      )}
      {board.me === null && board.entries.length > 0 ? <p className="mt-3 text-xs text-ink-faint">{l.notRanked}</p> : null}
    </Card>
  );
}

/** The compact Today card: one line about where the viewer stands this week. */
export async function LeaderboardSummaryCard({ board }: { board: Leaderboard }) {
  const { t } = await getI18n();
  const l = t.common.leaderboards;
  return (
    <Card>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">🏆 {l.title}</p>
      <p className="mt-1 text-sm">
        {board.me
          ? fill(l.yourRank, { rank: board.me.rank, metric: l.metrics.training_load, period: l.periods.week.toLowerCase() })
          : l.startToEnter}
      </p>
      <Link href="/leaderboards" className="mt-2 inline-block text-xs font-semibold text-accent-ink hover:underline">
        {l.viewLeaderboard} →
      </Link>
    </Card>
  );
}
