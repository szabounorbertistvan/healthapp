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
import { ADAPTIVE_WINDOW_DAYS, shiftDays, type NutritionDay, type NutritionEntry, type ProgressRange } from "@healthapp/shared";
import { isoDay } from "./dates";
import { myToday } from "./my-today";
import {
  NUTRITION_ENTRY_SELECT, toNutritionDays, toNutritionEntries, type DailyTotalRow, type NutritionEntryRow,
} from "./nutrition-map";
import { liveUser } from "./supabase/server";

/** PostgREST's row cap: an all-time read that returns this many days may be missing older ones. */
const ROW_CAP = 1000;
/** The weekly card compares this week with the whole week before: 13 days back covers both. */
const WEEK_LOOKBACK_DAYS = 13;

export type NutritionTrends = {
  days: NutritionDay[];
  /** First day with a food log, or null. */
  firstDay: string | null;
  /** The diary's calendar: today in the person's own zone (lib/my-today), the day food is logged on. */
  today: string;
  truncated: boolean;
};

export const getMyNutritionTrends = cache(async (range: ProgressRange): Promise<NutritionTrends | null> => {
  const live = await liveUser();
  if (!live) return null;
  const { supabase, userId } = live;
  // The range and the equally long one before it, and never less than the
  // two weeks the weekly card needs. Started from the server's day so it can
  // run alongside the zone lookup; the extra day covers any offset, and the
  // windows built on `today` decide what counts.
  const from = range === null ? null : shiftDays(isoDay(), -(Math.max(2 * range - 1, WEEK_LOOKBACK_DAYS) + 1));

  const [{ data, error }, { data: firstRow }, today] = await Promise.all([
    supabase.rpc("food_daily_totals", { p_from: from }),
    supabase.from("food_logs").select("date").eq("user_id", userId).order("date", { ascending: true }).limit(1).maybeSingle(),
    myToday(),
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

/** Rows per PostgREST page, and how many pages one view may read. */
const ENTRY_PAGE = 1000;
const ENTRY_PAGES = 6;

export type NutritionEntries = {
  entries: NutritionEntry[];
  /**
   * The oldest day whose entries were all read; null when everything since
   * `from` was. A window starting before it is not shown as if complete.
   */
  completeFrom: string | null;
};

/**
 * Single food_logs rows since `from` (null = all), newest first, for the meal
 * split and the label nutrients — the two things food_daily_totals cannot
 * answer. Paged under PostgREST's row cap and bounded: past ENTRY_PAGES the
 * read stops and says how far back it is complete, rather than averaging a
 * cut-off history. Filtered to the caller; RLS (food_logs owner policy)
 * answers it anyway, and foods are reached only through the caller's own logs.
 */
export const getMyNutritionEntries = cache(async (from: string | null): Promise<NutritionEntries | null> => {
  const live = await liveUser();
  if (!live) return null;
  const { supabase, userId } = live;
  const rows: NutritionEntryRow[] = [];
  for (let page = 0; page < ENTRY_PAGES; page++) {
    let query = supabase
      .from("food_logs")
      .select(NUTRITION_ENTRY_SELECT)
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .order("id", { ascending: true })
      .range(page * ENTRY_PAGE, (page + 1) * ENTRY_PAGE - 1);
    if (from !== null) query = query.gte("date", from);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to load food entries: ${error.message}`);
    const batch = (data ?? []) as unknown as NutritionEntryRow[];
    rows.push(...batch);
    if (batch.length < ENTRY_PAGE) return { entries: toNutritionEntries(rows), completeFrom: null };
  }
  // Stopped at the cap: the oldest day read may be only partly read, so
  // completeness starts the day after it.
  const oldest = rows.at(-1)?.date;
  return { entries: toNutritionEntries(rows), completeFrom: oldest ? shiftDays(oldest, 1) : null };
});

/**
 * What the adaptive-target estimate reads (packages/shared/adaptive-targets):
 * the diary's day totals and the weigh-ins of the last four weeks, in one
 * wave. A day of slack on the server's calendar covers any zone; the estimate
 * itself windows on the person's own `today`.
 */
export const getMyAdaptiveInputs = cache(async (): Promise<{
  today: string;
  days: { day: string; kcal: number }[];
  weights: { day: string; weight_kg: number }[];
} | null> => {
  const live = await liveUser();
  if (!live) return null;
  const { supabase, userId } = live;
  const from = shiftDays(isoDay(), -(ADAPTIVE_WINDOW_DAYS + 1));
  const [{ data: totals, error }, { data: weighIns }, today] = await Promise.all([
    supabase.rpc("food_daily_totals", { p_from: from }),
    supabase.from("measurements").select("date, weight_kg").eq("user_id", userId).gte("date", from).not("weight_kg", "is", null),
    myToday(),
  ]);
  if (error) return null;
  return {
    today,
    days: toNutritionDays((totals ?? []) as DailyTotalRow[]).map((d) => ({ day: d.day, kcal: d.kcal })),
    weights: ((weighIns ?? []) as { date: string; weight_kg: number }[]).map((w) => ({ day: w.date, weight_kg: Number(w.weight_kg) })),
  };
});
