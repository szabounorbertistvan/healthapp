// The reads behind a report — one person's rows, for one period.
//
// Whose rows is the ReportViewer's `userId`: the signed-in person's own
// (reportViewer(), from the session — /api/reports has no user id in it), or
// a client's for their coach (clientReportViewer(), only after the coach route
// found the client on the coach's active roster). Either way every query is
// filtered by that id and RLS answers it — the owner policies, or the coach
// read policies (is_active_coach_of) and client_food_daily_totals() for the
// day totals. A caller who is neither gets empty reads, never someone else's.
//
// Nothing is computed here beyond mapping rows; scoring reuses the existing
// mappers (toProgressSessions → loadOf, the Fitness Score's own loadOf input)
// and the existing readers (nutritionTargetFor, nutritionEntriesFor,
// goalDashboardFor). Reads are paged and capped; hitting a cap is reported
// (`truncated`) instead of silently cutting history.
import "server-only";
import { localDay, shiftDays, type FitnessScoreSession, type Macros } from "@healthapp/shared";
import { displayName, getProfile } from "../data";
import { nutritionTargetFor } from "../client-nutrition";
import { goalDashboardFor, type GoalView } from "../goals-data";
import { myCalendar, userCalendar } from "../my-today";
import { dailyTotalsFor, nutritionEntriesFor } from "../nutrition-data";
import { toNutritionDays, type DailyTotalRow } from "../nutrition-map";
import { toProgressSessions, type ProgressSessionJoin } from "../progress-map";
import { liveUser } from "../supabase/server";
import { loadOf, toLoadSet } from "../training-load";
import type { FoodRow } from "./csv-exports";
import { reportReadFrom, type ReportInputs, type ReportMeasurement, type ReportPeriod, type ReportSession } from "./report-model";

/** Sessions per page and the most pages one report reads (4 000 workouts ≈ ten years of near-daily training). */
const SESSION_PAGE = 500;
const SESSION_PAGES = 8;
/** Diary rows per page and the most pages (30 000 entries). */
const FOOD_PAGE = 1000;
const FOOD_PAGES = 30;

export class ReportTooLargeError extends Error {
  constructor() {
    super("REPORT_TOO_LARGE");
    this.name = "ReportTooLargeError";
  }
}

export type ReportViewer = {
  userId: string;
  owner: string;
  timeZone: string;
  today: string;
  units: { weight: "kg" | "lb"; length: "cm" | "in" };
};

/** Who is asking — from the session only. Null when signed out. */
export async function reportViewer(): Promise<ReportViewer | null> {
  const live = await liveUser();
  if (!live) return null;
  const [profile, calendar] = await Promise.all([getProfile(), myCalendar()]);
  return {
    userId: live.userId,
    owner: displayName(profile),
    timeZone: calendar.timeZone,
    today: calendar.today,
    units: { weight: profile?.weight_unit ?? "kg", length: profile?.length_unit ?? "cm" },
  };
}

/**
 * A client's report, for their coach: the client's rows and the client's own
 * calendar, in the coach's units (the coach is the one reading it). The caller
 * must already have found `clientId` on the coach's active roster; RLS answers
 * every read regardless.
 */
export async function clientReportViewer(clientId: string, clientName: string): Promise<ReportViewer | null> {
  const live = await liveUser();
  if (!live) return null;
  const [profile, calendar] = await Promise.all([getProfile(), userCalendar(clientId)]);
  return {
    userId: clientId,
    owner: clientName,
    timeZone: calendar.timeZone,
    today: calendar.today,
    units: { weight: profile?.weight_unit ?? "kg", length: profile?.length_unit ?? "cm" },
  };
}

const SESSION_SELECT = `id, started_at, completed_at, program_day_id, day:program_days(name),
  logged_sets(set_index, weight_kg, reps, duration_seconds, rpe, rir, is_pr, exercise_id,
    exercise:exercises(name_en, name_ro), prescribed:program_exercises(set_type))`;

type SessionJoin = {
  id: string;
  started_at: string;
  completed_at: string | null;
  program_day_id: string | null;
  day: { name: string } | null;
  logged_sets: {
    set_index: number; weight_kg: number | null; reps: number | null; duration_seconds: number | null;
    rpe: number | null; rir: number | null; is_pr: boolean | null; exercise_id: string | null;
    exercise: { name_en: string; name_ro: string | null } | null;
    prescribed: { set_type: string | null } | null;
  }[] | null;
};

export type TrainingRead = {
  progressSessions: ReportInputs["progressSessions"];
  fitnessSessions: FitnessScoreSession[];
  sessions: ReportSession[];
  firstTrainingDay: string | null;
  truncated: boolean;
};

/** Completed sessions from `from` to `to` (local days), with every set. */
export async function readTraining(viewer: ReportViewer, from: string, to: string, locale: "ro" | "en"): Promise<TrainingRead> {
  const live = await liveUser();
  if (!live) throw new Error("signed out");
  const { supabase } = live;
  // a day of slack on each side: the filter is on UTC instants, the period is local days
  const since = `${shiftDays(from, -1)}T00:00:00Z`;
  const until = `${shiftDays(to, 2)}T00:00:00Z`;
  const rows: SessionJoin[] = [];
  let truncated = false;
  for (let page = 0; page < SESSION_PAGES; page++) {
    const { data, error } = await supabase
      .from("logged_sessions")
      .select(SESSION_SELECT)
      .eq("user_id", viewer.userId)
      .not("completed_at", "is", null)
      .gte("started_at", since)
      .lt("started_at", until)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .range(page * SESSION_PAGE, (page + 1) * SESSION_PAGE - 1);
    if (error) throw new Error(`report sessions: ${error.message}`);
    const batch = (data ?? []) as unknown as SessionJoin[];
    rows.push(...batch);
    if (batch.length < SESSION_PAGE) break;
    if (page === SESSION_PAGES - 1) truncated = true;
  }
  const { data: firstRow } = await supabase
    .from("logged_sessions").select("started_at").eq("user_id", viewer.userId).not("completed_at", "is", null)
    .order("started_at", { ascending: true }).limit(1).maybeSingle<{ started_at: string }>();

  const tz = viewer.timeZone;
  const inside = rows.filter((r) => {
    if (r.completed_at === null) return false;
    const d = localDay(r.started_at, tz);
    return d >= from && d <= to;
  });
  const progressSessions = toProgressSessions(inside as unknown as ProgressSessionJoin[], tz);
  const fitnessSessions: FitnessScoreSession[] = inside.map((s) => {
    const load = loadOf((s.logged_sets ?? []).map(toLoadSet), s.started_at, s.completed_at);
    return { started_at: s.started_at, completed_at: s.completed_at, load: load.score, volume_kg: load.volume_kg };
  });
  const sessions: ReportSession[] = inside.map((s) => ({
    id: s.id,
    day: localDay(s.started_at, tz),
    started_at: s.started_at,
    completed_at: s.completed_at as string,
    name: s.day?.name ?? null,
    sets: (s.logged_sets ?? []).map((x) => ({
      exercise_id: x.exercise_id,
      exercise_name: (locale === "ro" ? x.exercise?.name_ro : null) ?? x.exercise?.name_en ?? "—",
      set_index: x.set_index,
      weight_kg: x.weight_kg ?? 0,
      reps: x.reps ?? 0,
      duration_seconds: x.duration_seconds,
      rpe: x.rpe,
      rir: x.rir,
      is_pr: Boolean(x.is_pr),
      warmup: x.prescribed?.set_type === "warmup",
    })),
  }));
  return {
    progressSessions,
    fitnessSessions,
    sessions,
    firstTrainingDay: firstRow ? localDay(firstRow.started_at, tz) : null,
    truncated,
  };
}

export async function readMeasurements(viewer: ReportViewer, period: ReportPeriod): Promise<ReportMeasurement[]> {
  const live = await liveUser();
  if (!live) throw new Error("signed out");
  const { data, error } = await live.supabase
    .from("measurements")
    .select("date, weight_kg, circumferences")
    .eq("user_id", viewer.userId)
    .gte("date", period.from)
    .lte("date", period.to)
    .order("date", { ascending: true })
    .limit(MAX_MEASUREMENT_ROWS);
  if (error) throw new Error(`report measurements: ${error.message}`);
  type Row = { date: string; weight_kg: number | string | null; circumferences: Record<string, unknown> | null };
  return ((data ?? []) as Row[]).map((r) => ({
    day: r.date,
    weight_kg: r.weight_kg === null ? null : Number(r.weight_kg),
    circumferences: Object.fromEntries(
      Object.entries(r.circumferences ?? {}).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1])),
    ),
  }));
}
/** One weigh-in a day at most, so a three-year period stays under this. */
const MAX_MEASUREMENT_ROWS = 1200;

export async function readFoods(viewer: ReportViewer, period: ReportPeriod): Promise<FoodRow[]> {
  const live = await liveUser();
  if (!live) throw new Error("signed out");
  const out: FoodRow[] = [];
  for (let page = 0; page < FOOD_PAGES; page++) {
    const { data, error } = await live.supabase
      .from("food_logs")
      .select("date, slot, food_name, grams, kcal, protein_g, carbs_g, fat_g")
      .eq("user_id", viewer.userId)
      .gte("date", period.from)
      .lte("date", period.to)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(page * FOOD_PAGE, (page + 1) * FOOD_PAGE - 1);
    if (error) throw new Error(`report foods: ${error.message}`);
    type Row = { date: string; slot: string; food_name: string | null; grams: number | null; kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null };
    const batch = (data ?? []) as Row[];
    out.push(...batch.map((r) => ({
      day: r.date, slot: r.slot, food_name: r.food_name ?? "", grams: r.grams, kcal: r.kcal, protein: r.protein_g, carbs: r.carbs_g, fat: r.fat_g,
    })));
    if (batch.length < FOOD_PAGE) return out;
  }
  // a CSV that silently lost the oldest rows would be wrong without looking wrong
  throw new ReportTooLargeError();
}

/** Every measurable goal (active and finished), or null when the dashboard read failed. */
export async function readGoals(viewer: ReportViewer): Promise<{ active: GoalView[]; all: GoalView[] } | null> {
  try {
    const d = await goalDashboardFor(viewer.userId, { today: viewer.today, timeZone: viewer.timeZone });
    if (!d) return null;
    return { active: d.active, all: [...d.active, ...d.closed] };
  } catch (e) {
    console.error(`report goals: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Everything the progress report needs, in one wave where the reads are independent. */
export async function loadProgressReportInputs(viewer: ReportViewer, period: ReportPeriod, locale: "ro" | "en"): Promise<ReportInputs> {
  const live = await liveUser();
  if (!live) throw new Error("signed out");
  const { supabase } = live;
  const readFrom = reportReadFrom(period);
  const [training, measurements, totals, nutritionFirst, planTarget, entries, goals, photos] = await Promise.all([
    readTraining(viewer, readFrom, period.to, locale),
    readMeasurements(viewer, period),
    dailyTotalsFor(viewer.userId, period.previous.start),
    supabase.from("food_logs").select("date").eq("user_id", viewer.userId).order("date", { ascending: true }).limit(1).maybeSingle<{ date: string }>(),
    nutritionTargetFor(viewer.userId),
    // a failed read is reported in the file (labelsMissing), never passed off as "no data"
    nutritionEntriesFor(viewer.userId, period.from).catch((e: unknown) => {
      console.error(`report nutrition entries: ${e instanceof Error ? e.message : String(e)}`);
      return "failed" as const;
    }),
    readGoals(viewer),
    supabase.from("progress_photos").select("id", { count: "exact", head: true })
      .eq("user_id", viewer.userId).gte("date", period.from).lte("date", period.to),
  ]);
  if (totals.error) throw new Error(`report nutrition: ${totals.error.message}`);
  if (nutritionFirst.error) console.error(`report nutrition first day: ${nutritionFirst.error.message}`);
  const entriesRead = entries === "failed" ? null : entries;
  const entriesComplete = entriesRead !== null && (entriesRead.completeFrom === null || entriesRead.completeFrom <= period.from);
  const nutritionDays = toNutritionDays((totals.data ?? []) as DailyTotalRow[]).filter((d) => d.day <= period.to);
  const t = planTarget;
  const target: Macros | null = t.kcal > 0 || t.protein > 0 || t.carbs > 0 || t.fat > 0 ? t : null;
  return {
    period,
    today: viewer.today,
    timeZone: viewer.timeZone,
    progressSessions: training.progressSessions,
    fitnessSessions: training.fitnessSessions,
    sessions: training.sessions,
    firstTrainingDay: training.firstTrainingDay,
    measurements,
    nutritionDays,
    // label nutrients only when every entry of the period was read
    nutritionEntries: entriesComplete ? entriesRead.entries : null,
    ...(entries === "failed" ? { nutritionEntriesMissing: "failed" as const } : entriesComplete ? {} : { nutritionEntriesMissing: "incomplete" as const }),
    nutritionFirstDay: nutritionFirst.data?.date ?? null,
    nutritionTarget: target,
    goals: goals?.active ?? null,
    photosInPeriod: photos.error ? null : (photos.count ?? 0),
    truncated: training.truncated,
  };
}
