// Advanced progress reads: the signed-in person's completed sessions over the
// chosen range and the one before it, scored per session, plus the day of
// their first ever session (so a "previous period" before they started is
// never compared against).
//
// Two queries, one wave. Both are filtered to the caller's own user_id and
// RLS (`sessions_owner`, `sets_owner`) answers them anyway — there is no id in
// here a URL could widen. Nothing is written and nothing new is stored: the
// load is loadOf(), the 1RM is relevantOneRm(), the local day is localDay(),
// the windows and folds are packages/shared/progress.
import "server-only";
import { cache } from "react";
import { localDay, todayIn, type ProgressRange, type ProgressSession } from "@healthapp/shared";
import { currentActorId } from "./actor";
import { daysAgoIso } from "./dates";
import { PROGRESS_SET_SELECT, toProgressSessions, type ProgressSessionJoin } from "./progress-map";
import { userTimezone } from "./streak-data";
import { supabaseServer } from "./supabase/server";

/**
 * Sessions an all-time read pulls at most — about four years at five a week.
 * Past it the page says its totals are a floor, as the exercise page does.
 */
const ALL_TIME_POOL = 1000;

export type ProgressTraining = {
  sessions: ProgressSession[];
  /** Local day of the first completed session ever, or null. */
  firstDay: string | null;
  today: string;
  timezone: string;
  /** True when the all-time read hit its cap. */
  truncated: boolean;
};

export const getMyProgressTraining = cache(async (range: ProgressRange): Promise<ProgressTraining | null> => {
  const userId = await currentActorId();
  if (!userId) return null;
  const supabase = await supabaseServer();

  let sessionsQuery = supabase
    .from("logged_sessions")
    .select(`id, started_at, completed_at, logged_sets(${PROGRESS_SET_SELECT})`)
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(ALL_TIME_POOL);
  // Two windows plus a day of slack: the filter is on UTC timestamps, the
  // windows are local days, and the two can differ by one.
  if (range !== null) sessionsQuery = sessionsQuery.gte("started_at", `${daysAgoIso(2 * range + 1)}T00:00:00`);

  const [{ data, error }, { data: firstRow }, timezone] = await Promise.all([
    sessionsQuery,
    supabase
      .from("logged_sessions")
      .select("started_at")
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .order("started_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    userTimezone(userId),
  ]);
  // An empty dashboard is a legitimate answer for a new account, so a failed
  // read must not be dressed up as one.
  if (error) throw new Error(`Failed to load progress sessions: ${error.message}`);

  const rows = (data ?? []) as unknown as ProgressSessionJoin[];
  const sessions = toProgressSessions(rows, timezone);
  const first = firstRow?.started_at as string | undefined;
  return {
    sessions,
    firstDay: first ? localDay(first, timezone) : null,
    today: todayIn(timezone),
    timezone,
    truncated: range === null && rows.length >= ALL_TIME_POOL,
  };
});
