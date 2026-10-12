import { describe, expect, it } from "vitest";
import { categoryOf, filterTaxonomy, foldText, groupSpecializations, SPECIALIZATION_CATEGORIES, specializationName } from "./coach-taxonomy";
import { coachProfileMessages } from "./i18n/messages/coach-profile";

const e = (slug: string, category: string | null, parent: string | null = null, name_ro = slug) =>
  ({ slug, name_en: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), name_ro, category, parent });

// the order the database sends (sort_order)
const catalog = [
  e("general-fitness", "strength"), e("muscle-building", "strength"), e("hypertrophy", "strength", "muscle-building"),
  e("yoga", "mind_body"), e("hatha-yoga", "mind_body", "yoga"), e("vinyasa-yoga", "mind_body", "yoga"),
  e("pilates", "mind_body"), e("swimming", "endurance", null, "Înot"), e("boxing", "combat", null, "Box"),
  e("nutrition", "other"),
];

describe("groupSpecializations", () => {
  it("groups in the fixed order, drops empty groups, keeps the database order inside", () => {
    const g = groupSpecializations(catalog);
    expect(g.map((x) => x.category)).toEqual(["strength", "mind_body", "endurance", "combat", "other"]);
    expect(g[1]!.items.map((i) => i.entry.slug)).toEqual(["yoga", "pilates"]);
  });
  it("puts a style under its discipline, never on its own", () => {
    const yoga = groupSpecializations(catalog)[1]!.items[0]!;
    expect(yoga.styles.map((s) => s.slug)).toEqual(["hatha-yoga", "vinyasa-yoga"]);
    const all = groupSpecializations(catalog).flatMap((g) => g.items.map((i) => i.entry.slug));
    expect(all).not.toContain("hatha-yoga");
  });
  it("a style whose discipline is missing still shows, top-level", () => {
    const g = groupSpecializations([e("hatha-yoga", "mind_body", "yoga")]);
    expect(g[0]!.items.map((i) => i.entry.slug)).toEqual(["hatha-yoga"]);
  });
  it("a legacy row without a group (before 20261116100000) lands in 'other'", () => {
    expect(categoryOf({ slug: "x", name_en: "X", name_ro: "X" })).toBe("other");
    expect(categoryOf(e("x", "made-up"))).toBe("other");
    expect(groupSpecializations([e("strength", null)]).map((x) => x.category)).toEqual(["other"]);
  });
  it("every entry appears exactly once", () => {
    const seen = groupSpecializations(catalog).flatMap((g) => g.items.flatMap((i) => [i.entry.slug, ...i.styles.map((s) => s.slug)]));
    expect(seen.sort()).toEqual(catalog.map((c) => c.slug).sort());
  });
  it("an empty catalog is no groups", () => {
    expect(groupSpecializations([])).toEqual([]);
  });
});

describe("filterTaxonomy", () => {
  it("matches either language, without diacritics", () => {
    expect(filterTaxonomy(catalog, "inot").map((x) => x.slug)).toEqual(["swimming"]);
    expect(filterTaxonomy(catalog, "BOX").map((x) => x.slug)).toEqual(["boxing"]);
  });
  it("keeps a matching style's discipline so the style can be shown under it", () => {
    expect(filterTaxonomy(catalog, "vinyasa").map((x) => x.slug)).toEqual(["yoga", "vinyasa-yoga"]);
  });
  it("an empty search keeps everything; no match keeps nothing", () => {
    expect(filterTaxonomy(catalog, "  ")).toHaveLength(catalog.length);
    expect(filterTaxonomy(catalog, "underwater basket")).toEqual([]);
  });
  it("folds case and diacritics", () => {
    expect(foldText("  Înot Ușor ")).toBe("inot usor");
  });
});

describe("labels", () => {
  it("names in the reader's language", () => {
    expect(specializationName({ name_en: "Swimming", name_ro: "Înot" }, "ro")).toBe("Înot");
    expect(specializationName({ name_en: "Swimming", name_ro: "Înot" }, "en")).toBe("Swimming");
  });
  it("every group has a label in both languages", () => {
    for (const locale of ["en", "ro"] as const) {
      const groups = coachProfileMessages[locale].taxonomy.groups;
      expect(Object.keys(groups).sort()).toEqual([...SPECIALIZATION_CATEGORIES].sort());
      for (const c of SPECIALIZATION_CATEGORIES) expect(groups[c].trim().length).toBeGreaterThan(0);
    }
    expect(coachProfileMessages.ro.taxonomy.groups.mind_body).not.toBe(coachProfileMessages.en.taxonomy.groups.mind_body);
  });
});
