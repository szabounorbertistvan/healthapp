// Turns the reviewed Romanian food-name list into an UPDATE for the live foods table.
//
// Input: the CSV relu reviewed (backups/alimente-nume-ro-de-verificat.csv,
// gitignored — the names are never committed, like seed/dishfinder-names.sql)
// plus the JSON written next to it, which carries the DishFinder ids. A row
// whose last column says STERGE is left out; any other text there replaces the
// proposed name.
//
// The SQL only fills `name_ro` where it is still null (an admin's or
// DishFinder's name always wins) and sets `dishfinder_ingredient_id` only
// where it is still null. Safe to re-run.
//
// Usage:
//   node scripts/build-ro-names-sql.mjs backups/alimente-nume-ro-de-verificat.csv
//   → backups/alimente-nume-ro.sql (apply with `supabase db query --linked -f`)
import { readFileSync, writeFileSync } from "node:fs";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("usage: node scripts/build-ro-names-sql.mjs <reviewed.csv>");
  process.exit(1);
}
const jsonPath = csvPath.replace(/\.csv$/, ".json");
const meta = new Map(JSON.parse(readFileSync(jsonPath, "utf8")).map((r) => [String(r.fdc), r]));

/** One CSV line, `;`-separated, double-quoted fields with "" escapes. */
function fields(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ";") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(csvPath, "utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1).filter((l) => l.trim());
const rows = [];
let dropped = 0;
let corrected = 0;
for (const line of lines) {
  const [, proposed, , , , fdc, correction = ""] = fields(line);
  const fix = correction.trim();
  if (/^sterge$/i.test(fix.normalize("NFD").replace(/[̀-ͯ]/g, ""))) { dropped++; continue; }
  if (fix) corrected++;
  const name = (fix || proposed).trim();
  if (!name || !/^\d+$/.test(fdc)) continue;
  rows.push({ fdc, name, df: meta.get(fdc)?.df ?? null });
}

const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const values = rows.map((r) => `  (${lit(r.fdc)}, ${lit(r.name)}, ${r.df ?? "null"}::int)`).join(",\n");
const sql = `-- Romanian names for USDA foods, reviewed ${new Date().toISOString().slice(0, 10)} (scripts/build-ro-names-sql.mjs).
-- Fills name_ro / dishfinder_ingredient_id only where still null. Safe to re-run.
begin;
update public.foods f
   set name_ro = coalesce(f.name_ro, v.name_ro),
       dishfinder_ingredient_id = coalesce(f.dishfinder_ingredient_id, v.df)
  from (values
${values}
  ) as v(fdc, name_ro, df)
 where f.source = 'usda' and f.external_id = v.fdc
   and (f.name_ro is null or (f.dishfinder_ingredient_id is null and v.df is not null));
commit;
`;
const out = csvPath.replace(/-de-verificat\.csv$/, ".sql").replace(/\.csv$/, ".sql");
writeFileSync(out, sql);
console.log(`${rows.length} names → ${out} (${corrected} corrected, ${dropped} dropped)`);
