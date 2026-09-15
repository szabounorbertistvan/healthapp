import { supabaseServer } from "@/lib/supabase/server";

// Reads for /admin/exercises — the translation desk for the shared exercise
// library. Mirrors lib/food-admin-data.ts, with one difference: an exercise
// carries two translatable fields (the name and the instructions), and the
// list is paged rather than capped, because 873 rows are worked through in
// order rather than searched one at a time.

export type TranslatableExercise = {
  id: string;
  name_en: string;
  name_ro: string | null;
  instructions_en: string;
  instructions_ro: string | null;
  primary_muscles: string[];
  images: string[];
};

export const EXERCISE_TRANSLATION_PAGE = 25;

export async function getExercisesForTranslation(opts: {
  q?: string;
  onlyMissing?: boolean;
  page?: number;
}): Promise<{ rows: TranslatableExercise[]; missing: number; total: number; page: number; pages: number }> {
  const q = opts.q?.trim() ?? "";
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const from = (page - 1) * EXERCISE_TRANSLATION_PAGE;

  const supabase = await supabaseServer();

  // Library rows only — a coach's custom exercise is theirs to name.
  const paged = () => {
    let query = supabase
      .from("exercises")
      .select("id, name_en, name_ro, instructions_en, instructions_ro, primary_muscles, images", { count: "exact" })
      .is("owner_id", null);
    if (opts.onlyMissing) query = query.is("name_ro", null);
    if (q) {
      const safe = q.replace(/[,()%\\]/g, " ").trim();
      if (safe) query = query.or(`name_en.ilike.%${safe}%,name_ro.ilike.%${safe}%`);
    }
    return query;
  };

  const [{ data, count }, { count: missing }] = await Promise.all([
    paged().order("name_en").range(from, from + EXERCISE_TRANSLATION_PAGE - 1),
    supabase
      .from("exercises")
      .select("id", { count: "exact", head: true })
      .is("owner_id", null)
      .is("name_ro", null),
  ]);

  const total = count ?? 0;
  return {
    rows: (data ?? []).map((r) => ({
      id: r.id as string,
      name_en: (r.name_en as string) ?? "",
      name_ro: (r.name_ro as string | null) ?? null,
      instructions_en: (r.instructions_en as string | null) ?? "",
      instructions_ro: (r.instructions_ro as string | null) ?? null,
      primary_muscles: (r.primary_muscles as string[] | null) ?? [],
      images: (r.images as string[] | null) ?? [],
    })),
    missing: missing ?? 0,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / EXERCISE_TRANSLATION_PAGE)),
  };
}
