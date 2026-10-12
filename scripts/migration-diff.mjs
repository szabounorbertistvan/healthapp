#!/usr/bin/env node
// Read-only: compares a remote migration ledger with the local migration files.
// It touches no database; you paste what the remote says.
//
//   1. In the Supabase SQL editor of the CONFIRMED project, run
//        select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;
//      (or save the output of `npx supabase migration list --linked`) into a file.
//   2. node scripts/migration-diff.mjs <that file>
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diff, localVersions, parseVersions } from "./lib/migration-diff.mjs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/migration-diff.mjs <file with the remote versions>");
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const local = localVersions(readdirSync(join(root, "supabase", "migrations")));
const remote = parseVersions(readFileSync(file, "utf8"));
const d = diff(local.versions, remote);

console.log(`local files: ${local.versions.length} · remote versions: ${remote.length} · newest remote: ${d.newestRemote ?? "-"}`);
if (local.duplicates.length) console.log(`DUPLICATE local versions (fix before any push): ${local.duplicates.join(", ")}`);
console.log(`pending (local, not on remote): ${d.pending.length}`);
for (const v of d.pending) console.log(`  ${local.names.get(v)}${d.outOfOrder.includes(v) ? "   <- older than the newest remote: db push needs --include-all" : ""}`);
console.log(`remote only (no local file — renamed, or applied from elsewhere): ${d.remoteOnly.length}`);
for (const v of d.remoteOnly) console.log(`  ${v}`);
if (d.remoteOnly.length || local.duplicates.length) process.exitCode = 2;
