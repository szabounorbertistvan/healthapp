// Backs up the live Supabase database to backups/<timestamp>/ on this machine.
//
//   npm run db:backup
//
// Needs the Supabase CLI logged in (`supabase login`) and a local pg_dump of
// the server's major version or newer (PostgreSQL 17 —
// C:\Program Files\PostgreSQL\17\bin is found on its own; PG_DUMP=<path>
// overrides). No Docker and no database password: `supabase db dump --dry-run`
// mints a short-lived login role and prints the pg_dump script it would run,
// and this script takes the connection from it and runs the local pg_dump.
//
// Writes, per run:
//   db.dump     pg_dump custom format (compressed) of the schemas that are
//               ours to lose: public (everything the app stores), auth
//               (accounts and password hashes), storage (bucket and object
//               metadata — not the files themselves) and supabase_migrations
//               (the ledger). Schema, data and grants.
//   schema.sql  the same schemas' DDL as plain SQL, to read or diff.
//
// Restore (selectively — a fresh Supabase project already owns auth/storage):
//   pg_restore --list backups/<ts>/db.dump                      what is inside
//   pg_restore -d "<db url>" --schema public --clean --if-exists backups/<ts>/db.dump
//   pg_restore -d "<db url>" --data-only --schema auth backups/<ts>/db.dump
//
// The dump is everyone's health data and password hashes: backups/ is
// gitignored — never commit it, never upload it anywhere unencrypted.
// Old backups are never deleted here; prune backups/ by hand.
//
// PROJECT_REF=<ref> backs up another project (default: the live one).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_REF = process.env.PROJECT_REF ?? "caiaretlxiljiiuoirtp";
const SCHEMAS = ["public", "auth", "storage", "supabase_migrations"];
const isWin = process.platform === "win32";

function findPgDump() {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  const probe = spawnSync(isWin ? "where" : "which", ["pg_dump"], { encoding: "utf8" });
  if (probe.status === 0) return probe.stdout.split(/\r?\n/)[0].trim();
  const root = "C:\\Program Files\\PostgreSQL";
  if (isWin && existsSync(root)) {
    const versions = readdirSync(root).filter((v) => /^\d+$/.test(v)).sort((a, b) => b - a);
    for (const v of versions) {
      const exe = join(root, v, "bin", "pg_dump.exe");
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error("pg_dump not found — install PostgreSQL 17 client tools or set PG_DUMP=<path>");
}

// The connection the CLI would use, read off its dry-run script. Never printed.
function connection() {
  const run = spawnSync(
    "supabase",
    ["db", "dump", "--linked", "--project-ref", PROJECT_REF, "--dry-run"],
    { encoding: "utf8", shell: isWin },
  );
  const out = `${run.stdout}\n${run.stderr}`;
  const env = {};
  for (const m of out.matchAll(/^export (PG[A-Z]+)=(?:"([^"]*)"|'([^']*)'|(\S*))$/gm)) {
    env[m[1]] = m[2] ?? m[3] ?? m[4];
  }
  if (!env.PGHOST || !env.PGUSER || !env.PGPASSWORD) {
    const hint = out.split(/\r?\n/).filter((l) => /error|login|link/i.test(l)).slice(0, 3).join("\n");
    throw new Error(`could not get a connection from the Supabase CLI (is it logged in?)\n${hint}`);
  }
  return env;
}

function dump(pgDump, env, args, file) {
  const run = spawnSync(
    pgDump,
    ["--role", "postgres", ...SCHEMAS.flatMap((s) => ["--schema", s]), ...args, "--file", file],
    { env: { ...process.env, ...env, PGSSLMODE: "require" }, stdio: ["ignore", "inherit", "inherit"] },
  );
  if (run.status !== 0) throw new Error(`pg_dump failed (exit ${run.status ?? run.signal})`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = join("backups", stamp);

try {
  const pgDump = findPgDump();
  console.log(`backing up ${PROJECT_REF} → ${dir}`);
  const env = connection();
  mkdirSync(dir, { recursive: true });

  dump(pgDump, env, ["--format", "custom", "--compress", "6"], join(dir, "db.dump"));
  dump(pgDump, env, ["--schema-only", "--format", "plain"], join(dir, "schema.sql"));

  for (const f of readdirSync(dir)) {
    const mb = (statSync(join(dir, f)).size / 1024 / 1024).toFixed(1);
    console.log(`  ${f.padEnd(11)} ${mb} MB`);
  }
  console.log("done");
} catch (e) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  console.error(`backup failed: ${e.message}`);
  process.exit(1);
}
