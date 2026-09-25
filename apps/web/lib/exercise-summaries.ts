import "server-only";
import type { ExerciseSummary } from "@healthapp/shared";
import { supabaseServer } from "./supabase/server";
import { activeCoachId } from "./client-training";
import { fetchVideoLinks, resolveVideo, videoLinksFor } from "./exercise-video-links";

/**
 * A handful of exercises by id, in the picker's shape and with the demo link
 * resolved the way the library search does it — so a training day can hand
 * each row its detail popup up front. The rows, the coach lookup and the
 * links go out together: one wave. RLS decides what is visible.
 */
export async function getExerciseSummaries(ids: string[]): Promise<Record<string, ExerciseSummary>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return {};
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id ?? null;
  const [{ data, error }, coachId, linkRows] = await Promise.all([
    supabase
      .from("exercises")
      .select(
        "id, external_id, name_en, name_ro, category, level, force, mechanic, equipment, primary_muscles, secondary_muscles, instructions_en, images, video_url, owner_id",
      )
      .in("id", unique),
    me ? activeCoachId(me) : Promise.resolve(null),
    me ? fetchVideoLinks(supabase) : Promise.resolve([]),
  ]);
  if (error || !data) return {};
  const links = videoLinksFor(linkRows, me ?? "", coachId);
  type Row = ExerciseSummary & { id: string; owner_id: string | null };
  return Object.fromEntries(
    (data as unknown as Row[]).map(({ owner_id, ...e }) => [
      e.id,
      { ...e, ...resolveVideo(links, e.id, e.video_url), mine: owner_id !== null && owner_id === me },
    ]),
  );
}
