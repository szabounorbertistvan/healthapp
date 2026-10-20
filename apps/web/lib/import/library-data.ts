import "server-only";
import { liveUser } from "@/lib/supabase/server";
import type { LibraryExercise } from "./exercise-match";

/**
 * Every exercise the person can log against — the library plus their own
 * (RLS: exercises_select) — in the slim shape the import's matcher and
 * review picker need. Paged past PostgREST's 1000-row cap.
 */
export async function getImportLibrary(): Promise<LibraryExercise[]> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const PAGE = 1000;
  const out: LibraryExercise[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("exercises")
      .select("id, name_en, name_ro, equipment, owner_id")
      .order("name_en", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load the exercise library: ${error.message}`);
    type Row = { id: string; name_en: string; name_ro: string | null; equipment: string | null; owner_id: string | null };
    for (const r of (data ?? []) as Row[]) {
      out.push({ id: r.id, name_en: r.name_en, name_ro: r.name_ro, equipment: r.equipment, mine: r.owner_id === userId });
    }
    if (!data || data.length < PAGE) return out;
  }
}
