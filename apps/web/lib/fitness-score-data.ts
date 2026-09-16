// Fitness score reads. One query — a person's completed sessions and sets
// over the last two 28-day blocks — scored per session by lib/training-load
// (the same loadOf() Today, history and the weekly summary use) and folded by
// packages/shared/fitness-score. Nothing is stored and nothing is written.
//
// Whose score: the signed-in user's own, or a client's for their coach. The
// query is filtered by user_id and RLS on logged_sessions / logged_sets
// decides whether the caller may read those rows (is_active_coach_of); an
// unrelated caller gets no rows and therefore a "building" score with every
// count at zero — never someone else's numbers.
import "server-only";
import { cache } from "react";
import {
  FITNESS_SCORE_PERIOD_DAYS,
  fitnessScore,
  fitnessScoreTrend,
  todayIn,
  type FitnessScore,
  type FitnessScoreSession,
  type FitnessScoreTrend,
} from "@healthapp/shared";
import { currentActorId } from "./actor";
import { daysAgoIso } from "./dates";
import { supabaseServer } from "./supabase/server";
import { userTimezone } from "./streak-data";
import { LOAD_SET_SELECT, loadOf, toLoadSet, type LoadSetJoin } from "./training-load";

export type FitnessScoreView = {
  /** The 28 days ending today. */
  current: FitnessScore;
  /** The 28 days before those — scored by the same function, for the trend. */
  previous: FitnessScore;
  trend: FitnessScoreTrend;
  timezone: string;
  today: string;
};

/**
 * Both windows for one person. Cached per request: Today asks once for the
 * card; the coach's client page asks once for its section.
 */
const fitnessScoreFor = cache(async (userId: string): Promise<FitnessScoreView> => {
  const supabase = await supabaseServer();
  // Two blocks plus a day of slack on each side: the filter below is on UTC
  // timestamps, the score counts local days, and the two can differ by a day.
  const since = daysAgoIso(2 * FITNESS_SCORE_PERIOD_DAYS + 1);
  const [{ data }, timezone] = await Promise.all([
    supabase
      .from("logged_sessions")
      .select(`started_at, completed_at, logged_sets(${LOAD_SET_SELECT})`)
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .gte("started_at", `${since}T00:00:00`),
    userTimezone(userId),
  ]);

  type Row = { started_at: string; completed_at: string | null; logged_sets: LoadSetJoin[] | null };
  const sessions: FitnessScoreSession[] = ((data ?? []) as unknown as Row[]).map((s) => {
    const load = loadOf((s.logged_sets ?? []).map(toLoadSet), s.started_at, s.completed_at);
    return { started_at: s.started_at, completed_at: s.completed_at, load: load.score, volume_kg: load.volume_kg };
  });

  const today = todayIn(timezone);
  const current = fitnessScore({ sessions, timeZone: timezone, today, periodsAgo: 0 });
  const previous = fitnessScore({ sessions, timeZone: timezone, today, periodsAgo: 1 });
  return { current, previous, trend: fitnessScoreTrend(current, previous), timezone, today };
});

/** The signed-in user's own score. */
export async function getMyFitnessScore(): Promise<FitnessScoreView | null> {
  const viewer = await currentActorId();
  if (!viewer) return null;
  return fitnessScoreFor(viewer);
}

/**
 * A client's score as their coach sees it. The id comes from the URL, and
 * nothing here trusts it: RLS answers the session query, and the page only
 * renders the result for a client on the coach's active roster.
 */
export async function getClientFitnessScore(clientId: string): Promise<FitnessScoreView> {
  return fitnessScoreFor(clientId);
}
