// Per-exercise history reads.
//
// Two questions, one query shape each:
//
//   getPreviousWorkouts(day)   what did I do last time, for every lift of a
//                              training day — the block above the set logger
//   getExerciseHistory(id)     everything I have ever done on one lift — the
//                              exercise detail page
//
// Both go through logged_sets with `logged_sessions!inner`, so an unfinished
// workout can never become "last time": PostgREST drops the set when its
// session has no completed_at. The rows come back already restricted to the
// signed-in user by policy `sets_owner` (user_id = auth.uid()), which is why
// none of this needs an RPC — there is no query here a client could widen.
//
// The index that makes it cheap already existed and had no reader until now:
//   logged_sets_history_idx on (user_id, exercise_id, received_at desc)
//
// All arithmetic lives in @healthapp/shared/exercise-analytics; this file only
// fetches and shapes.
import "server-only";
import { cache } from "react";
import {
  exerciseSessions,
  exerciseStats,
  previousWorkouts,
  repRecords,
  type ExerciseSessionEntry,
  type ExerciseStats,
  type ExerciseVideoSource,
  type PreviousWorkout,
  type RepRecord,
} from "@healthapp/shared";
import { ANALYTICS_SET_SELECT, toAnalyticsSets, type AnalyticsSetJoin } from "./exercise-analytics-map";
import { liveUser } from "./supabase/server";
import { activeCoachId } from "./client-training";
import { fetchVideoLinks, resolveVideo, videoLinksFor } from "./exercise-video-links";
import type { ClientWorkoutDay } from "./types";

/**
 * How many rows the two reads pull. A day is a handful of lifts and only the
 * newest session of each matters, so the pool is capped rather than unbounded;
 * a year of hard training on one lift is ~600 sets, which the detail page
 * still fits inside.
 */
const PREVIOUS_POOL = 600;
const HISTORY_POOL = 1200;

/**
 * What this person last did on each exercise of a training day, per set.
 *
 * Keyed by `program_exercises.id` (as `pe:<id>`) and by `exercises.id`, so the
 * heavy block and the back-off block of the same lift each get their own
 * numbers. One query for the whole day — never one per exercise.
 *
 * Cached per request: the log page reads it, and the day page asks for the
 * same day's memory right above it.
 */
export const getPreviousWorkouts = cache(async (dayKey: string, exerciseIds: readonly string[]) => {
  const ids = [...new Set(exerciseIds)].filter(Boolean);
  const empty = new Map<string, PreviousWorkout>();
  if (ids.length === 0) return empty;
  const live = await liveUser();
  if (!live) return empty;
  const { supabase, userId } = live;

  const { data, error } = await supabase
    .from("logged_sets")
    .select(ANALYTICS_SET_SELECT)
    .eq("user_id", userId)
    .in("exercise_id", ids)
    .not("session.completed_at", "is", null)
    .order("received_at", { ascending: false })
    .limit(PREVIOUS_POOL);
  // A read failure must not masquerade as "you have never done this": the
  // logger would then pre-fill from the prescription and quietly lose the
  // person's own numbers. Empty is the honest answer only when the query ran.
  if (error) {
    console.error(`[exercise-analytics] previous workouts for day ${dayKey}: ${error.message}`);
    return empty;
  }
  return previousWorkouts(toAnalyticsSets((data ?? []) as unknown as AnalyticsSetJoin[]));
});

/** The same, addressed by the training day the set logger is showing. */
export function getPreviousForDay(day: ClientWorkoutDay) {
  return getPreviousWorkouts(
    day.day_id,
    day.exercises.map((e) => e.exercise_id).filter((id): id is string => Boolean(id)),
  );
}

export type ExerciseHistory = {
  /** Heaviest load for at least N reps, N = 1…12 (repRecords). */
  records: RepRecord[];
  sessions: ExerciseSessionEntry[];
  stats: ExerciseStats;
  /** True when the cap was hit, so the page can say the totals are a floor. */
  truncated: boolean;
};

/** Every completed set of one exercise, grouped into sessions and summed. */
export async function getExerciseHistory(exerciseId: string): Promise<ExerciseHistory> {
  const live = await liveUser();
  const blank: ExerciseHistory = { sessions: [], stats: exerciseStats([]), records: [], truncated: false };
  if (!live) return blank;
  const { supabase, userId } = live;

  const { data, error } = await supabase
    .from("logged_sets")
    .select(ANALYTICS_SET_SELECT)
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .not("session.completed_at", "is", null)
    .order("received_at", { ascending: false })
    .limit(HISTORY_POOL);
  if (error) {
    throw new Error(`Failed to load history for exercise ${exerciseId}: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as AnalyticsSetJoin[];
  const sessions = exerciseSessions(toAnalyticsSets(rows));
  return { sessions, stats: exerciseStats(sessions), records: repRecords(sessions), truncated: rows.length >= HISTORY_POOL };
}

export type ExerciseProfile = {
  id: string;
  name_en: string;
  name_ro: string | null;
  category: string | null;
  level: string | null;
  equipment: string | null;
  mechanic: string | null;
  force: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  images: string[];
  instructions_en: string | null;
  instructions_ro: string | null;
  /** The demo this person sees: their own link, else their coach's, else the row's (resolveVideo). */
  video_url: string | null;
  video_source: ExerciseVideoSource | null;
  /** A custom exercise the viewer owns — its row video is theirs to clear. */
  mine: boolean;
};

/**
 * The library row behind an id, with its demo video resolved for this person.
 * Readable by any signed-in user for system exercises and by its owner for a
 * custom one — policy `exercises_select`, unchanged. The video links come
 * through `exercise_video_links` RLS: your own, and those of whoever you are
 * actively connected to. One wave: row, links and coach id together.
 */
export async function getExerciseProfile(exerciseId: string): Promise<ExerciseProfile | null> {
  const live = await liveUser();
  if (!live) return null;
  const { supabase, userId } = live;
  const [{ data, error }, linkRows, coachId] = await Promise.all([
    supabase
      .from("exercises")
      .select("id, name_en, name_ro, category, level, equipment, mechanic, force, primary_muscles, secondary_muscles, images, instructions_en, instructions_ro, video_url, owner_id, source")
      .eq("id", exerciseId)
      .maybeSingle(),
    fetchVideoLinks(supabase),
    activeCoachId(userId),
  ]);
  if (error || !data) return null;
  type Row = Omit<ExerciseProfile, "video_source" | "mine"> & { owner_id: string | null; source: string | null };
  const { owner_id, source, ...row } = data as unknown as Row;
  return {
    ...row,
    primary_muscles: row.primary_muscles ?? [],
    secondary_muscles: row.secondary_muscles ?? [],
    ...resolveVideo(videoLinksFor(linkRows, userId, coachId), row.id, row.video_url),
    mine: owner_id === userId && source === "custom",
  };
}
