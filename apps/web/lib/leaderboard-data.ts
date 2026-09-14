// Leaderboard reads. One RPC per board — social_leaderboard() does the whole
// aggregation and ranking in the database and hands back the top rows plus
// the caller's own; the rules it applies are packages/shared/leaderboard.
// Cached per request: Today asks for the same board the page shows.
import "server-only";
import { cache } from "react";
import {
  LEADERBOARD_TOP,
  isLeaderboardMetric,
  isLeaderboardPeriod,
  type Leaderboard,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type LeaderboardScope,
} from "@healthapp/shared";
import { supabaseServer } from "./supabase/server";

type Row = {
  rank: number;
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  score: number | string;
  secondary_score: number | string;
  is_current_user: boolean;
};

/** The metric the URL names, or the default. */
export function metricOf(input: string | undefined): LeaderboardMetric {
  return isLeaderboardMetric(input) ? input : "training_load";
}
export function periodOf(input: string | undefined): LeaderboardPeriod {
  return isLeaderboardPeriod(input) ? input : "week";
}

/**
 * One board: the top rows and the viewer's own row (inside the top, or
 * below it — `me` is also present in `entries` when it ranks that high).
 * `total` is unknown to the RPC, which returns only what is shown; it is
 * the highest rank seen, enough for "you're #27".
 */
export const getLeaderboard = cache(
  async (metric: LeaderboardMetric, period: LeaderboardPeriod, scope: LeaderboardScope = "global"): Promise<Leaderboard> => {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc("social_leaderboard", {
      p_metric: metric,
      p_period: period,
      p_scope: scope,
      p_limit: LEADERBOARD_TOP,
    });
    if (error) return { entries: [], me: null, total: 0 };
    const rows: LeaderboardRow[] = ((data ?? []) as Row[]).map((r) => ({
      rank: r.rank,
      user_id: r.user_id,
      display_name: r.display_name ?? "—",
      username: r.username,
      avatar_url: r.avatar_url,
      created_at: "",
      score: Number(r.score),
      secondary: Number(r.secondary_score),
      is_current_user: r.is_current_user,
    }));
    return {
      entries: rows.filter((r) => r.rank <= LEADERBOARD_TOP),
      me: rows.find((r) => r.is_current_user) ?? null,
      total: rows.reduce((max, r) => Math.max(max, r.rank), 0),
    };
  },
);
