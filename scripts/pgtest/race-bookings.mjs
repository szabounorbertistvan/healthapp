// Two people book the same slot at the same moment (20261105100000).
//
// pgTAP runs a suite inside one transaction on one connection, so it can show
// that an overlapping booking is refused but not that two *concurrent* ones
// are. This does: the same throwaway Postgres as run.mjs, every migration,
// fixtures committed, then two connections call book_service() for one slot
// in parallel — and, separately, two raw overlapping inserts that skip the
// RPC entirely, so the exclusion constraint alone is on trial.
//
//   node scripts/pgtest/race-bookings.mjs
import EmbeddedPostgres from "embedded-postgres";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, "../../supabase/migrations");

const scope = path.join(HERE, "node_modules/@embedded-postgres");
if (!existsSync(scope)) throw new Error("Run `npm install` inside scripts/pgtest first.");
// Windows builds keep extensions in share/extension, Linux and macOS in share/postgresql/extension
const share = readdirSync(scope)
  .flatMap((p) => ["native/share/extension", "native/share/postgresql/extension"].map((sub) => path.join(scope, p, sub)))
  .find(existsSync);
writeFileSync(path.join(share, "pgtap.control"), "default_version = '0.1'\nrelocatable = true\n");
writeFileSync(path.join(share, "pgtap--0.1.sql"), readFileSync(path.join(HERE, "pgtap--0.1.sql"), "utf8"));

const pg = new EmbeddedPostgres({
  databaseDir: mkdtempSync(path.join(tmpdir(), "pgrace-")),
  user: "postgres", password: "postgres",
  port: Number(process.env.PGTEST_PORT ?? 54398),
  persistent: false,
  // Postgres refuses to run as root (a Linux container): run it as a postgres user, created if missing
  createPostgresUser: process.getuid?.() === 0,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
await pg.initialise();
await pg.start();
const admin = pg.getPgClient();
await admin.connect();
await admin.query(readFileSync(path.join(HERE, "bootstrap.sql"), "utf8"));
await admin.query('set search_path = "$user", public, extensions');
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
  await admin.query(readFileSync(path.join(MIGRATIONS, f), "utf8"));
}

const COACH = "cb000000-0000-0000-0000-000000000001";
const ANN = "cb000000-0000-0000-0000-000000000002";
const BEN = "cb000000-0000-0000-0000-000000000003";
const SERVICE = "cbb00000-0000-0000-0000-000000000001";

// committed fixtures: a published coach with a bookable service and a block on D
await admin.query(`
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${COACH}', 'coach@race.local', '{"full_name":"Coach","username":"coach_race"}'),
    ('${ANN}', 'ann@race.local', '{"full_name":"Ann","username":"ann_race"}'),
    ('${BEN}', 'ben@race.local', '{"full_name":"Ben","username":"ben_race"}');
  update public.users set timezone = 'Europe/Bucharest' where id = '${COACH}';
  insert into public.coach_profiles (user_id, slug, status, published_at, headline, online)
  values ('${COACH}', 'coach-race', 'published', now(), 'Coach', true);
  insert into public.coach_services (id, coach_profile_id, name, price_unit, bookable, booking_duration_minutes, booking_confirmation)
  select '${SERVICE}', id, 'PT', 'session', true, 60, 'instant' from public.coach_profiles where slug = 'coach-race';
  insert into public.coach_availability (coach_id, weekday, start_time, end_time)
  values ('${COACH}', extract(isodow from (now() at time zone 'Europe/Bucharest')::date + 3), '09:00', '12:00');
`);
const { rows: [{ slot }] } = await admin.query(
  `select (((now() at time zone 'Europe/Bucharest')::date + 3) + time '10:00') at time zone 'Europe/Bucharest' as slot`);

async function as(user) {
  const c = pg.getPgClient();
  await c.connect();
  await c.query('set search_path = "$user", public, extensions');
  await c.query("begin");
  await c.query("select set_config('role', 'authenticated', true)");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
  return c;
}

let failed = 0;
function check(ok, label) {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) failed++;
}

// 1. two clients, one slot, through the RPC, at the same moment
{
  const [a, b] = await Promise.all([as(ANN), as(BEN)]);
  const results = await Promise.allSettled([
    a.query("select public.book_service($1, $2)", [SERVICE, slot]).then(() => a.query("commit")),
    b.query("select public.book_service($1, $2)", [SERVICE, slot]).then(() => b.query("commit")),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const refused = results.filter((r) => r.status === "rejected" && /SLOT_UNAVAILABLE/.test(r.reason?.message)).length;
  check(ok === 1 && refused === 1, `two simultaneous book_service() calls: one booked, one SLOT_UNAVAILABLE (${ok} ok, ${refused} refused)`);
  for (const c of [a, b]) { await c.query("rollback").catch(() => {}); await c.end(); }
  const { rows: [{ n }] } = await admin.query(
    "select count(*)::int as n from public.bookings where coach_id = $1 and status in ('pending', 'confirmed')", [COACH]);
  check(n === 1, `exactly one live booking for the slot (${n})`);
}

// 2. the constraint alone: two raw overlapping inserts in parallel transactions
{
  const one = pg.getPgClient(); const two = pg.getPgClient();
  await one.connect(); await two.connect();
  const insert = `insert into public.bookings (client_id, coach_id, service_name, start_at, end_at, timezone, block_start, block_end, status)
                  values ($1, '${COACH}', 'raw', $2::timestamptz + interval '1 hour', $2::timestamptz + interval '2 hours', 'UTC',
                          $2::timestamptz + interval '1 hour', $2::timestamptz + interval '2 hours', 'confirmed')`;
  await one.query("begin"); await two.query("begin");
  await one.query(insert, [ANN, slot]);
  // two blocks on one's uncommitted row until one commits, then fails
  const second = two.query(insert, [BEN, slot]).then(() => "inserted", (e) => e.code);
  await new Promise((r) => setTimeout(r, 300));
  await one.query("commit");
  const outcome = await second;
  check(outcome === "23P01", `a concurrent overlapping raw insert waits, then fails with 23P01 (${outcome})`);
  await two.query("rollback").catch(() => {});
  await one.end(); await two.end();
}

await admin.end();
await pg.stop();
console.log(failed ? `\n${failed} failures` : "\nall green");
process.exit(failed ? 1 : 0);
