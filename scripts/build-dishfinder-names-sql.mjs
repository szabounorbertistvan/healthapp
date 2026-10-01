// Turns a DishFinder ingredient export into supabase/seed/dishfinder-names.sql:
// Romanian names and DishFinder ids for the USDA foods both products share.
//
// Why: the USDA import is English only and nobody has translated a row by
// hand. DishFinder (docs/DISHFINDER.md) already carries human-written Romanian
// names for ~600 ingredients and keys them to the same USDA fdc id we keep in
// foods.external_id. Its ingredient id also lets a planned meal deep-link into
// its finder pages (apps/web/lib/dishfinder.ts).
//
// Input: a JSON array exported from DishFinder's database — every ingredient,
// `fdc` null where its nutrition row has no USDA reference:
//   [{ id, name_en, name_ro, fdc, uses }]
//   select i.id, i.name_en, i.name_ro,
//          nullif(replace(coalesce(n.source_ref,''),'fdc:',''),'') fdc,
//          <menu + recipe use count> uses
//     from ingredients i left join ingredient_nutrition n on n.ingredient_id = i.id
//    where i.merged_into is null;
//
// Two updates come out. The USDA one joins on the fdc id. The second links our
// own curated staples (seed/foods.sql, external_id 'curated:*' — what coach
// plans are actually built from) to their DishFinder ingredient by the hand map
// below, id only: those rows already have Romanian names.
//
// Usage:
//   node scripts/build-dishfinder-names-sql.mjs <export.json>
//
// The output is gitignored on purpose: the Romanian names are DishFinder's
// hand-written work and are applied straight to the live project, never
// committed. Keep the export out of the repo too.
//
// The SQL only fills `name_ro` where it is still null — an admin's translation
// outranks the import — and always (re)sets dishfinder_ingredient_id. Needs
// migration 20261019110000. Safe to re-run.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "supabase/seed/dishfinder-names.sql");
const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/build-dishfinder-names-sql.mjs <dishfinder-export.json>");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(input, "utf8"));
const usdaSeed = readFileSync(path.join(root, "supabase/seed/usda-foods.sql"), "utf8");
const known = new Set([...usdaSeed.matchAll(/\('usda', '(\d+)'/g)].map((m) => m[1]));

// Several DishFinder names can share one USDA row (22 pasta shapes → "Pasta,
// cooked"). Our food is the generic one, so keep the most-used name and, on a
// tie, the shortest — "pasta" over "pappardelle", "almonds" over "flaked almonds".
const byFdc = new Map();
for (const r of rows) {
  const fdc = String(r.fdc ?? "").trim();
  const ro = String(r.name_ro ?? "").trim();
  if (!fdc || !ro || !Number.isInteger(r.id)) continue;
  const prev = byFdc.get(fdc);
  const better =
    !prev ||
    (r.uses ?? 0) > (prev.uses ?? 0) ||
    ((r.uses ?? 0) === (prev.uses ?? 0) && r.name_en.length < prev.name_en.length);
  // DishFinder writes names lower-case ("piept de pui"); our list capitalises
  // the first letter ("Lapte 1,5%"), so match that and leave the rest alone.
  if (better) byFdc.set(fdc, { ...r, fdc, name_ro: ro.charAt(0).toUpperCase() + ro.slice(1) });
}

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const picked = [...byFdc.values()].filter((r) => known.has(r.fdc));
const missing = byFdc.size - picked.length;
picked.sort((a, b) => a.fdc.localeCompare(b.fdc));

const values = picked.map((r) => `  (${lit(r.fdc)}, ${r.id}, ${lit(r.name_ro)})`).join(",\n");

// Our curated staples → the DishFinder ingredient that *is* that food. Names
// are DishFinder's `name_en`; a few of ours have no counterpart and are left
// out on purpose (cașcaval, deli chicken). Keep in step with
// supabase/seed/foods.sql.
const CURATED = {
  "chicken-breast": "chicken breast", "chicken-thigh": "chicken thigh", "turkey-breast": "turkey breast",
  "beef-mince-10": "ground beef", "pork-loin": "pork loin", salmon: "salmon", cod: "cod", "tuna-can": "tuna",
  egg: "eggs", "egg-white": "egg white", whey: "whey protein powder", "greek-yogurt": "greek yogurt",
  "cottage-cheese": "cottage cheese", telemea: "telemea cheese", "milk-15": "milk", kefir: "kefir", oats: "oats",
  "rice-cooked": "rice", "rice-raw": "rice", "pasta-cooked": "pasta", potato: "potatoes", "sweet-potato": "sweet potatoes",
  "bread-wholegrain": "whole wheat bread", polenta: "polenta", buckwheat: "buckwheat", quinoa: "quinoa",
  lentils: "lentils", chickpeas: "chickpeas", "beans-white": "white beans", banana: "banana", apple: "apples",
  blueberries: "blueberries", strawberries: "strawberries", orange: "oranges", grapes: "grapes", broccoli: "broccoli",
  spinach: "spinach", tomato: "tomatoes", cucumber: "cucumbers", "bell-pepper": "bell pepper", carrot: "carrots",
  onion: "onion", zucchini: "zucchini", cabbage: "cabbage", cauliflower: "cauliflower", "green-beans": "green beans",
  peas: "peas", mushrooms: "mushrooms", beetroot: "beetroot", aubergine: "eggplant", sweetcorn: "sweet corn",
  lettuce: "lettuce", garlic: "garlic", pear: "pears", peach: "peach", watermelon: "watermelon", cherries: "cherries",
  "mixed-salad": "mixed salad greens",
  "yogurt-plain": "plain yogurt", "sour-cream": "sour cream", tofu: "tofu", "sunflower-seeds": "sunflower seeds",
  "dark-chocolate": "dark chocolate", honey: "honey", "olive-oil": "olive oil", "sunflower-oil": "sunflower oil",
  butter: "butter", almonds: "almonds", walnuts: "walnuts", "peanut-butter": "peanut butter", avocado: "avocado",
};
// Resolve a name, tolerating DishFinder's singular/plural choice.
const byName = new Map(rows.filter((r) => Number.isInteger(r.id)).map((r) => [r.name_en.toLowerCase().trim(), r.id]));
const variants = (n) => [n, n.replace(/ies$/, "y"), n.replace(/es$/, ""), n.replace(/s$/, ""), `${n}s`, `${n}es`, n.replace(/y$/, "ies")];
const curatedRows = [];
const unresolved = [];
for (const [slug, name] of Object.entries(CURATED)) {
  const id = variants(name).map((v) => byName.get(v)).find((v) => v != null);
  if (id == null) unresolved.push(`${slug} → "${name}"`);
  else curatedRows.push(`  (${lit(`curated:${slug}`)}, ${id})`);
}
if (unresolved.length) console.warn(`curated staples without a DishFinder match (left out):\n  ${unresolved.join("\n  ")}`);
const sql = `-- HealthApp · Romanian names + DishFinder ids for shared USDA foods (${picked.length} rows)
--
-- GENERATED by scripts/build-dishfinder-names-sql.mjs. Do not edit by hand.
-- Source: DishFinder ingredients joined to ingredient_nutrition.source_ref
-- ('fdc:<id>'), matched here on foods.external_id for source 'usda'.
-- ${missing} DishFinder rows point at fdc ids outside our SR Legacy import and were skipped.
--
-- name_ro is set where null or still equal (any case) to an earlier import; an admin's own text wins;
-- dishfinder_ingredient_id is always set. Needs migration 20261019110000.
-- Run with: supabase db query --linked --project-ref <ref> -f supabase/seed/dishfinder-names.sql

update public.foods f
   set name_ro = case
         -- empty, or still exactly what an earlier run of this file wrote
         -- (case-insensitively): take the import. Anything else is an admin's.
         when f.name_ro is null or lower(f.name_ro) = lower(v.name_ro) then v.name_ro
         else f.name_ro
       end,
       dishfinder_ingredient_id = v.dishfinder_id
  from (values
${values}
  ) as v(fdc, dishfinder_id, name_ro)
 where f.source = 'usda'
   and f.external_id = v.fdc;

-- Our curated staples (seed/foods.sql): id only, they are already in Romanian.
update public.foods f
   set dishfinder_ingredient_id = v.dishfinder_id
  from (values
${curatedRows.join(",\n")}
  ) as v(external_id, dishfinder_id)
 where f.source = 'custom'
   and f.external_id = v.external_id;
`;

writeFileSync(output, sql, "utf8");
console.log(
  `wrote ${path.relative(root, output)}: ${picked.length} USDA foods named (${rows.length} export rows, ${byFdc.size} distinct fdc ids, ${missing} not in our USDA import) + ${curatedRows.length} curated staples linked`,
);
