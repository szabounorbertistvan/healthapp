import { normalizeForSearch } from "@healthapp/shared";
import { supabaseServer } from "@/lib/supabase/server";

// Reads for /admin/foods — the translation desk for the shared food library.

export type TranslatableFood = {
  id: string;
  source: string;
  name_en: string;
  name_ro: string | null;
  kcal_100g: number;
};

export const FOOD_TRANSLATION_PAGE = 50;

export async function getFoodsForTranslation(opts: {
  q?: string;
  onlyMissing?: boolean;
}): Promise<{ rows: TranslatableFood[]; missing: number }> {
  const q = opts.q?.trim() ?? "";


  const supabase = await supabaseServer();

  // Shared rows only — a coach's custom foods are theirs to name.
  let query = supabase
    .from("foods")
    .select("id, source, name_en, name_ro, kcal_100g")
    .in("source", ["usda", "off"])
    .order("name_en")
    .limit(FOOD_TRANSLATION_PAGE);
  if (opts.onlyMissing) query = query.is("name_ro", null);
  if (q) {
    const safe = normalizeForSearch(q.replace(/[,()%\\]/g, " "));
    if (safe) query = query.ilike("search_text", `%${safe}%`);
  }

  const [{ data }, { count }] = await Promise.all([
    query,
    supabase
      .from("foods")
      .select("id", { count: "exact", head: true })
      .in("source", ["usda", "off"])
      .is("name_ro", null),
  ]);

  return {
    rows: (data ?? []).map((r) => ({
      id: r.id,
      source: r.source,
      name_en: r.name_en ?? "",
      name_ro: r.name_ro,
      kcal_100g: Number(r.kcal_100g),
    })),
    missing: count ?? 0,
  };
}
