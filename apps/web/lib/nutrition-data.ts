// Nutrition trends reads: the caller's food_logs summed per day
// (food_daily_totals, one row per day — never raw logs), over the chosen range
// and the one before it, plus the first day anything was logged so a
// "previous period" before the person started is never compared against.
//
// Two queries, one wave, both answering for the signed-in user only (the RPC
// uses auth.uid(); the date read is filtered by user_id and RLS). The target,
// today's totals and the plan come from the diary's own reads
// (getMyDayNutrition, getMyPlanMeals) — one source for "the target".
import "server-only";
import { cache } from "react";
import { shiftDays, type NutritionDay, type ProgressRange } from "@healthapp/shared";
import { isoDay } from "./dates";
import { toNutritionDays, type DailyTotalRow } from "./nutrition-map";
import { liveUser } from "./supabase/server";

/** PostgREST's row cap: an all-time read that returns this many days may be missing older ones. */
const ROW_CAP = 1000;
/** The weekly card compares this week with the whole week before: 13 days back covers both. */
const WEEK_LOOKBACK_DAYS = 13;

export type NutritionTrends = {
  days: NutritionDay[];
  /** First day with a food log, or null. */
  firstDay: string | null;
  /** The diary's calendar: food_logs.date is written with isoDay(). */
  today: string;
  truncated: boolean;
};

export const getMyNutritionTrends = cache(async (range: ProgressRange): Promise<NutritionTrends | null> => {
  const live = await liveUser();
  if (!live) return null;
  const { supabase, userId } = live;
  const today = isoDay();
  // The range and the equally long one before it, and never less than the
  // two weeks the weekly card needs.
  const from = range === null ? null : shiftDays(today, -Math.max(2 * range - 1, WEEK_LOOKBACK_DAYS));

  const [{ data, error }, { data: firstRow }] = await Promise.all([
    supabase.rpc("food_daily_totals", { p_from: from }),
    supabase.from("food_logs").select("date").eq("user_id", userId).order("date", { ascending: true }).limit(1).maybeSingle(),
  ]);
  // Empty is a legitimate answer for a new account; a failed read (the
  // migration not applied yet, say) must not be dressed up as one.
  if (error) throw new Error(`Failed to load nutrition history: ${error.message}`);

  const rows = (data ?? []) as DailyTotalRow[];
  return {
    days: toNutritionDays(rows),
    firstDay: (firstRow?.date as string | undefined) ?? null,
    today,
    truncated: rows.length >= ROW_CAP,
  };
});
