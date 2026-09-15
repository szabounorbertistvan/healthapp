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
        className={`flex min-h-14 items-center gap-3 px-5 py-2.5 ${r.is_current_user ? "bg-accent-soft" : "hover:bg-bg/60"}`}
        aria-current={r.is_current_user ? "true" : undefined}
      >
        <span
          className={`w-7 shrink-0 text-center text-[15px] tabular-nums ${r.rank <= 3 ? "font-bold" : "font-semibold text-ink-faint"}`}
          aria-label={`${l.rank} ${r.rank}`}
        >
          {MEDALS[r.rank] ?? r.rank}
        </span>
        <Avatar name={r.display_name} url={r.avatar_url} size="h-9 w-9" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
          {r.display_name}
          {r.is_current_user ? <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent-ink">{l.you}</span> : null}
        </span>
        <span className="shrink-0 font-display text-[15px] font-bold tabular-nums">
          {formatScore(r.score, locale)}
          {unit ? <span className="ml-1 font-sans text-[11.5px] font-medium text-ink-faint">{unit}</span> : null}
        </span>
      </Link>
    </li>
  );

  return (
    <Card plain className="overflow-hidden p-0">
      <div className="flex items-baseline justify-between gap-3 px-5 pb-3 pt-[18px]">
        <p className="font-display text-lg font-bold tracking-tight">{l.metrics[metric]}</p>
        <p className="text-[12.5px] text-ink-faint">{l.periods[period]}</p>
      </div>
      {board.entries.length === 0 ? (
        <p className="px-5 pb-[18px] text-[13px] text-ink-faint">{l.emptyBoard}</p>
      ) : (
        <ul className="divide-y divide-line/60 border-t border-line/60">
          {board.entries.map(row)}
          {meBelow && board.me ? (
            <>
              <li aria-hidden className="py-1 text-center text-xs text-ink-faint">···</li>
              {row(board.me)}
            </>
          ) : null}
        </ul>
      )}
      {board.me === null && board.entries.length > 0 ? (
        <p className="border-t border-line/60 px-5 py-3 text-[12.5px] text-ink-faint">{l.notRanked}</p>
      ) : null}
    </Card>
  );
}

/** The compact Today card: one line about where the viewer stands this week. */
export async function LeaderboardSummaryCard({ board }: { board: Leaderboard }) {
  const { t } = await getI18n();
  const l = t.common.leaderboards;
  return (
    <Card plain>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{l.title}</p>
      <p className="mt-1.5 text-[13.5px] text-ink-soft">
        {board.me
          ? fill(l.yourRank, { rank: board.me.rank, metric: l.metrics.training_load, period: l.periods.week.toLowerCase() })
          : l.startToEnter}
      </p>
      <Link href="/leaderboards" className="mt-3 inline-block text-[12.5px] font-semibold text-accent-ink hover:underline">
        {l.viewLeaderboard} →
      </Link>
    </Card>
  );
}
