// Turns the USDA FoodData Central "SR Legacy" CSV release into
// supabase/seed/usda-foods.sql — the generic ingredient list behind food search.
//
// Why USDA: Open Food Facts is a barcode database of packaged products and has
// no "cabbage, raw" or "chicken breast". SR Legacy is the classic generic
// composition table (public domain, frozen in 2018, which is fine for staples).
//
// English only. `name_ro` is left null; admins fill it in from /admin/foods and
// the upsert below never overwrites a translation someone has typed.
//
// Usage:
//   1. download https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
//   2. unzip; the folder holds food.csv, food_category.csv, food_nutrient.csv
//   3. node scripts/build-usda-seed-sql.mjs <path-to-that-folder>
//
// Paste the output into the dashboard SQL editor (see supabase/README.md).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "supabase/seed/usda-foods.sql");
const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/build-usda-seed-sql.mjs <folder with food.csv>");
  process.exit(1);
}

// US-only categories that mean nothing to a Romanian meal plan.
const EXCLUDED_CATEGORIES = new Set([
  "Baby Foods",
  "Fast Foods",
  "Restaurant Foods",
  "Meals, Entrees, and Side Dishes",
  "American Indian/Alaska Native Foods",
]);

// FoodData Central nutrient ids. The last three feed the label-style columns
// (saturated_fat_100g, sugar_100g, salt_100g); sodium arrives in mg and is
// converted to grams of salt (NaCl) below, the EU-label convention.
const NUTRIENT = {
  1008: "kcal",
  1003: "protein",
  1005: "carbs",
  1004: "fat",
  1258: "satfat", // Fatty acids, total saturated (g)
  2000: "sugar", // Sugars, total (g)
  1093: "sodium", // Sodium, Na (mg)
};
const SALT_PER_MG_SODIUM = 2.5 / 1000;

const ROWS_PER_STATEMENT = 200;

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, no embedded newlines in this dataset. */
function csv(file) {
  const text = readFileSync(path.join(dir, file), "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}
function split(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const categories = new Map(csv("food_category.csv").map((c) => [c.id, c.description]));
const foods = csv("food.csv").filter((f) => !EXCLUDED_CATEGORIES.has(categories.get(f.food_category_id)));
const keep = new Set(foods.map((f) => f.fdc_id));

const macros = new Map();
for (const n of csv("food_nutrient.csv")) {
  const key = NUTRIENT[n.nutrient_id];
  if (!key || !keep.has(n.fdc_id)) continue;
  const m = macros.get(n.fdc_id) ?? {};
  m[key] = Number(n.amount);
  macros.set(n.fdc_id, m);
}

function lit(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
function num(value) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0";
}
/** Like num(), but a missing measurement stays null — "not measured" is not "0 g". */
function opt(value) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "null";
}

const rows = [];
let skipped = 0;
for (const f of foods) {
  const m = macros.get(f.fdc_id);
  // No energy value means the row cannot be logged against a target; drop it.
  if (!m || !Number.isFinite(m.kcal)) {
    skipped++;
    continue;
  }
  const salt = Number.isFinite(m.sodium) ? m.sodium * SALT_PER_MG_SODIUM : NaN;
  rows.push(
    `(${lit("usda")}, ${lit(f.fdc_id)}, ${lit(f.description.trim())}, ${num(m.kcal)}, ${num(m.protein ?? 0)}, ${num(m.carbs ?? 0)}, ${num(m.fat ?? 0)}, ` +
      `${opt(m.satfat)}, ${opt(m.sugar)}, ${opt(salt)}, true)`,
  );
}

const statements = [];
for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
  statements.push(
    `insert into public.foods (source, external_id, name_en, kcal_100g, protein_100g, carbs_100g, fat_100g, saturated_fat_100g, sugar_100g, salt_100g, verified) values\n` +
      rows.slice(i, i + ROWS_PER_STATEMENT).map((r) => `  ${r}`).join(",\n") +
      `\non conflict (source, external_id) do update set\n` +
      `  name_en = excluded.name_en,\n  kcal_100g = excluded.kcal_100g,\n  protein_100g = excluded.protein_100g,\n` +
      `  carbs_100g = excluded.carbs_100g,\n  fat_100g = excluded.fat_100g,\n` +
      `  saturated_fat_100g = excluded.saturated_fat_100g,\n  sugar_100g = excluded.sugar_100g,\n  salt_100g = excluded.salt_100g,\n` +
      `  verified = excluded.verified;`,
  );
}

const header = `-- HealthApp · USDA SR Legacy generic foods (${rows.length} rows, English names)
--
-- GENERATED by scripts/build-usda-seed-sql.mjs. Do not edit by hand.
-- Source: USDA FoodData Central, SR Legacy release 2018-04 (public domain).
-- external_id is the FoodData Central fdc_id. Excluded categories:
--   ${[...EXCLUDED_CATEGORIES].join(", ")}.
-- ${skipped} rows without an energy value were dropped.
--
-- name_ro is intentionally absent: translations are added by admins in the app
-- and the upsert never touches that column, so re-running keeps them.
-- saturated_fat_100g / sugar_100g / salt_100g need migration 20261019100000;
-- salt is sodium (mg) × 2.5 / 1000, the EU-label convention; null = not measured.
-- Paste into the Supabase dashboard → SQL Editor → Run. Safe to re-run.

`;

writeFileSync(output, header + statements.join("\n\n") + "\n", "utf8");
console.log(
  `wrote ${path.relative(root, output)}: ${rows.length} rows in ${statements.length} statements (${skipped} skipped, ${foods.length} candidates)`,
);
