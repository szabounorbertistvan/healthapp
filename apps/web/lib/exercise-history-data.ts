import "server-only";
import {
  exerciseSessions, exerciseSummary, repRecords,
  type ExerciseSession, type ExerciseStats, type RepRecord, type ExerciseVideoSource,
} from "@healthapp/shared";
import { liveUser } from "./supabase/server";
import { getLocale } from "./i18n/server";
import { activeCoachId } from "./client-training";
import { fetchVideoLinks, resolveVideo, videoLinksFor } from "./exercise-video-links";

export type ExerciseHistoryView = {
  exercise: {
    id: string;
    name: string;
    primary_muscles: string[];
    secondary_muscles: string[];
    equipment: string | null;
    instructions: string | null;
    video_url: string | null;
    video_source: ExerciseVideoSource | null;
    /** A custom exercise the viewer owns (its row video is theirs to clear). */
    mine: boolean;
  };
  sessions: ExerciseSession[];
  summary: ExerciseStats;
  records: RepRecord[];
};

/**
 * Far past a lifetime of one exercise (three sessions a week of five sets is
 * ~800 a year) but bounded, like every other history read here.
 */
const MAX_SETS = 3000;

/**
 * One exercise and everything the signed-in person ever logged on it. One
 * wave: the exercise row, the sets (logged_sets_history_idx is exactly
 * user_id, exercise_id, received_at), the demo-video links and the coach id
 * go out together. Returns null for an exercise RLS does not show.
 *
 * Every figure comes from @healthapp/shared (exercise-history.ts), so this
 * page and the PR badge in the logger use the one 1RM formula.
 */
export async function getMyExerciseHistory(exerciseId: string): Promise<ExerciseHistoryView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(exerciseId)) return null;
  const live = await liveUser();
  if (!live) return null;
  const { supabase, userId } = live;

  const [locale, { data: row }, { data: sets }, linkRows, coachId] = await Promise.all([
    getLocale(),
    supabase
      .from("exercises")
      .select("id, name_en, name_ro, primary_muscles, secondary_muscles, equipment, instructions_en, instructions_ro, video_url, owner_id, source")
      .eq("id", exerciseId)
      .maybeSingle(),
    supabase
      .from("logged_sets")
      .select("session_id, set_index, weight_kg, reps, is_pr, received_at, session:logged_sessions(started_at)")
      .eq("user_id", userId)
      .eq("exercise_id", exerciseId)
      .order("received_at", { ascending: false })
      .limit(MAX_SETS),
    fetchVideoLinks(supabase),
    activeCoachId(userId),
  ]);
  if (!row) return null;

  type SetRow = {
    session_id: string; set_index: number; weight_kg: number | null; reps: number | null;
    is_pr: boolean | null; received_at: string; session: { started_at: string } | null;
  };
  const sessions = exerciseSessions(
    ((sets ?? []) as unknown as SetRow[]).map((s) => ({
      session_id: s.session_id,
      session_at: s.session?.started_at ?? s.received_at,
      set_index: s.set_index,
      weight_kg: s.weight_kg === null ? null : Number(s.weight_kg),
      reps: s.reps ?? 0,
      is_pr: Boolean(s.is_pr),
    })),
  );
  const links = videoLinksFor(linkRows, userId, coachId);
  const ro = locale === "ro";
  return {
    exercise: {
      id: row.id,
      name: (ro ? row.name_ro : null) ?? row.name_en,
      primary_muscles: row.primary_muscles ?? [],
      secondary_muscles: row.secondary_muscles ?? [],
      equipment: row.equipment,
      instructions: (ro ? row.instructions_ro : null) ?? row.instructions_en,
      ...resolveVideo(links, row.id, row.video_url),
      mine: row.owner_id === userId && row.source === "custom",
    },
    sessions,
    summary: exerciseSummary(sessions),
    records: repRecords(sessions),
  };
}
