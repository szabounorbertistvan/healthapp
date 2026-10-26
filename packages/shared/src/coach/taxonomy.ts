/**
 * The coach discipline taxonomy for the web app (migration 20261116100000).
 * Pure and client-safe. The taxonomy itself lives in public.specializations
 * — slug (the identifier), name_en / name_ro (labels), a group (`category`)
 * and at most one level of styles (`parent`). This file only groups, orders
 * and searches what the database sent; it never invents an entry, and the
 * server (coach_apply_specializations) remains the only validator.
 */

/** The picker's groups, in the order they are shown. Mirrors the check constraint. */
export const SPECIALIZATION_CATEGORIES = ["strength", "mind_body", "functional", "endurance", "combat", "other"] as const;
export type SpecializationCategory = (typeof SPECIALIZATION_CATEGORIES)[number];

/** What grouping needs from a specialization; catalog rows and facets both have it. */
export type TaxonomyEntry = {
  slug: string;
  name_en: string;
  name_ro: string;
  /** Absent on a database without 20261116100000: treated as "other". */
  category?: string | null;
  /** The discipline's slug when this is a style of it. */
  parent?: string | null;
};

export type TaxonomyGroup<T extends TaxonomyEntry> = {
  category: SpecializationCategory;
  /** Top-level disciplines, each with its styles (possibly none), in the order given. */
  items: { entry: T; styles: T[] }[];
};

export function categoryOf(e: TaxonomyEntry): SpecializationCategory {
  return (SPECIALIZATION_CATEGORIES as readonly string[]).includes(e.category ?? "") ? (e.category as SpecializationCategory) : "other";
}

/**
 * Groups in SPECIALIZATION_CATEGORIES order, empty groups dropped, the input
 * order (the database's sort_order) kept inside each. A style whose
 * discipline is not in the list (filtered out, or skipped at migration time)
 * stands on its own rather than disappearing.
 */
export function groupSpecializations<T extends TaxonomyEntry>(entries: readonly T[]): TaxonomyGroup<T>[] {
  const present = new Set(entries.map((e) => e.slug));
  const styles = new Map<string, T[]>();
  for (const e of entries) {
    if (e.parent && e.parent !== e.slug && present.has(e.parent)) {
      styles.set(e.parent, [...(styles.get(e.parent) ?? []), e]);
    }
  }
  const groups = new Map<SpecializationCategory, TaxonomyGroup<T>["items"]>();
  for (const e of entries) {
    if (e.parent && e.parent !== e.slug && present.has(e.parent)) continue;
    const cat = categoryOf(e);
    groups.set(cat, [...(groups.get(cat) ?? []), { entry: e, styles: styles.get(e.slug) ?? [] }]);
  }
  return SPECIALIZATION_CATEGORIES.flatMap((category) => {
    const items = groups.get(category);
    return items?.length ? [{ category, items }] : [];
  });
}

export function specializationName(e: Pick<TaxonomyEntry, "name_en" | "name_ro">, locale: "en" | "ro"): string {
  return locale === "ro" ? e.name_ro : e.name_en;
}

/** Lower case, no diacritics: "Înot" and "inot" are the same search. */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * The entries a picker's search box keeps: a match on either language's
 * label or the slug, plus the discipline of a matching style so the style is
 * still shown under it. An empty search keeps everything.
 */
export function filterTaxonomy<T extends TaxonomyEntry>(entries: readonly T[], query: string): T[] {
  const q = foldText(query);
  if (!q) return [...entries];
  const hit = (e: T) => [e.name_en, e.name_ro, e.slug.replace(/-/g, " ")].some((s) => foldText(s).includes(q));
  const keep = new Set(entries.filter(hit).map((e) => e.slug));
  for (const e of entries) if (keep.has(e.slug) && e.parent) keep.add(e.parent);
  return entries.filter((e) => keep.has(e.slug));
}
