import { normalizeForSearch } from "@healthapp/shared";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import { demoFoods } from "@/lib/demo-foods";

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

  if (isDemo) {
    // Demo rows all carry Romanian names, so the "missing" view is empty by
    // design; the search still works for a look at the screen.
    const needle = normalizeForSearch(q);
    const rows = demoFoods
      .filter((f) => !needle || normalizeForSearch(`${f.name_en} ${f.name_ro}`).includes(needle))
      .filter((f) => !opts.onlyMissing || !f.name_ro)
      .slice(0, FOOD_TRANSLATION_PAGE)
      .map((f) => ({
        id: f.id,
        source: "demo",
        name_en: f.name_en,
        name_ro: f.name_ro,
        kcal_100g: f.per_100g.kcal,
      }));
    return { rows, missing: 0 };
  }

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
