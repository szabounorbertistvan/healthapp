// Per-person exercise demo links (exercise_video_links), resolved to the one
// video each exercise shows: yours, else your active coach's, else the row's
// own video_url (pickExerciseVideo in @healthapp/shared).
import "server-only";
import { pickExerciseVideo, type ExerciseVideoSource } from "@healthapp/shared";
import type { supabaseServer } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof supabaseServer>>;
export type VideoLinks = Map<string, { own?: string; coach?: string }>;

/**
 * Every link RLS lets this person read — their own and their connected
 * people's — keyed by exercise, keeping only theirs and their coach's. It
 * needs neither the exercise ids nor the coach id up front, so it rides in
 * the same wave as the query it decorates; the filtering happens in memory.
 *
 * A failure is logged and answered with no links rather than thrown: a demo
 * video is decoration, and a set logger that will not open because the video
 * table is unreachable (or its migration not yet applied) is far worse than
 * one without videos.
 */
export async function fetchVideoLinks(supabase: Supabase): Promise<{ user_id: string; exercise_id: string; video_id: string }[]> {
  const { data, error } = await supabase.from("exercise_video_links").select("user_id, exercise_id, video_id");
  if (error) {
    console.error(`exercise_video_links read failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as { user_id: string; exercise_id: string; video_id: string }[];
}

export function videoLinksFor(
  rows: readonly { user_id: string; exercise_id: string; video_id: string }[],
  userId: string,
  coachId: string | null,
): VideoLinks {
  const byExercise: VideoLinks = new Map();
  for (const row of rows) {
    const layer = row.user_id === userId ? "own" : row.user_id === coachId ? "coach" : null;
    if (!layer) continue;
    const entry = byExercise.get(row.exercise_id) ?? {};
    entry[layer] = row.video_id;
    byExercise.set(row.exercise_id, entry);
  }
  return byExercise;
}

/** The resolved demo for one exercise, in the shape ExerciseSummary / ProgramExerciseRow carry. */
export function resolveVideo(
  links: VideoLinks,
  exerciseId: string | null | undefined,
  rowVideo: string | null | undefined,
): { video_url: string | null; video_source: ExerciseVideoSource | null } {
  const layers = exerciseId ? links.get(exerciseId) : undefined;
  const picked = pickExerciseVideo({ own: layers?.own, coach: layers?.coach, exercise: rowVideo });
  return { video_url: picked?.url ?? null, video_source: picked?.source ?? null };
}
