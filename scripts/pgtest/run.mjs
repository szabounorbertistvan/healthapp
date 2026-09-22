// Apply every migration to a throwaway Postgres and run the pgTAP suites —
// without Docker.
//
// `npm run db:test` needs `supabase start`, which needs Docker. On a box that
// has none (the Windows dev machine this repo is mostly written on), this is
// the fallback: embedded-postgres downloads a real Postgres, this script
// bootstraps just enough Supabase around it (the three roles, the auth schema,
// auth.uid()), applies supabase/migrations in order and runs every file in
// supabase/tests.
//
// It is a FALLBACK, not a replacement. See README.md for what it does not do.
//
//   node scripts/pgtest/run.mjs              every suite
//   node scripts/pgtest/run.mjs program_lib  only suites whose name matches
import EmbeddedPostgres from "embedded-postgres";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MIGRATIONS = path.join(REPO, "supabase/migrations");
const TESTS = path.join(REPO, "supabase/tests");
const filter = process.argv[2] ?? null;

/**
 * embedded-postgres installs its binaries in a per-platform package
 * (@embedded-postgres/windows-x64, .../linux-x64, .../darwin-arm64…). Find
 * whichever one is actually here rather than assuming this machine's.
 */
function extensionDir() {
  const scope = path.join(HERE, "node_modules/@embedded-postgres");
  if (!existsSync(scope)) {
    throw new Error("Dependencies are missing. Run `npm install` inside scripts/pgtest first.");
  }
  for (const pkg of readdirSync(scope)) {
    const dir = path.join(scope, pkg, "native/share/extension");
    if (existsSync(dir)) return dir;
  }
  throw new Error("No embedded-postgres binaries found under scripts/pgtest/node_modules.");
}

// Drop the stub pgTAP next to the real extensions so `create extension pgtap`
// finds it. See README.md — this is a stand-in for the real thing.
const share = extensionDir();
writeFileSync(
  path.join(share, "pgtap.control"),
  "comment = 'stub pgtap (scripts/pgtest)'\ndefault_version = '0.1'\nrelocatable = true\n",
);
writeFileSync(path.join(share, "pgtap--0.1.sql"), readFileSync(path.join(HERE, "pgtap--0.1.sql"), "utf8"));

const dataDir = mkdtempSync(path.join(tmpdir(), "pgtap-"));
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: Number(process.env.PGTEST_PORT ?? 54399),
  persistent: false,
  // Without this, initdb picks the system codepage (WIN1252 on a Romanian
  // Windows box) and the first migration carrying a diacritic fails to load.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();

let failed = 0;

try {
  await client.query(readFileSync(path.join(HERE, "bootstrap.sql"), "utf8"));
} catch (e) {
  console.error("bootstrap failed: " + e.message);
  process.exit(1);
}

// `alter database … set search_path` in bootstrap.sql only reaches NEW
// sessions, and this one is already open. Without this line every test dies on
// `function plan(integer) does not exist`.
await client.query('set search_path = "$user", public, extensions');

const migrations = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
for (const file of migrations) {
  try {
    await client.query(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  } catch (e) {
    console.error(`MIGRATION FAIL ${file}: ${e.message}`);
    failed++;
    break;
  }
}

if (!failed) {
  // `supabase db push` records every file it applies; this script applies them
  // directly, so it records them too — admin_system_health() reads this table.
  for (const file of migrations) {
    await client.query(
      "insert into supabase_migrations.schema_migrations (version) values ($1) on conflict do nothing",
      [file.split("_")[0]],
    );
  }
  console.log(`applied ${migrations.length} migrations`);

  const tests = readdirSync(TESTS)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !filter || f.includes(filter))
    .sort();
  if (tests.length === 0) console.log(`no suite matched "${filter}"`);

  for (const file of tests) {
    const sql = readFileSync(path.join(TESTS, file), "utf8");
    try {
      const res = await client.query(sql);
      // A multi-statement query comes back as an array of results, one per
      // statement; every assertion is a single-column row of TAP text.
      const rows = (Array.isArray(res) ? res : [res])
        .flatMap((r) => (r.rows ?? []).map((x) => Object.values(x)[0]))
        .filter((x) => typeof x === "string");
      const bad = rows.filter((r) => r.startsWith("not ok"));
      const good = rows.filter((r) => r.startsWith("ok"));
      failed += bad.length;
      console.log(`${bad.length ? "FAIL" : "ok  "}  ${file}  (${good.length} passed, ${bad.length} failed)`);
      bad.forEach((b) => console.log("      " + b));
    } catch (e) {
      failed++;
      console.log(`ERROR ${file}: ${String(e.message).slice(0, 200)}`);
      // The suite wraps itself in begin/rollback; a mid-suite throw leaves the
      // connection in a failed transaction that would poison the next file.
      try { await client.query("rollback"); } catch { /* already rolled back */ }
    }
  }
}

await client.end();
await pg.stop();
console.log(failed ? `\n${failed} failures` : "\nall green");
process.exit(failed ? 1 : 0);
