// The write-scope rules of 20261122100000_coach_write_scope, exercised through
// a real PostgREST — the layer the app actually talks to — instead of SQL.
//
// run.mjs proves the policies in SQL, with `set role` and a hand-set JWT
// claim. This script proves the same rules hold for an HTTP request: a JWT
// signed the way Supabase signs it, PostgREST switching to anon /
// authenticated from that token, and requests built by @supabase/postgrest-js,
// the query builder behind every `supabase.from(...)` in apps/web. It answers
// the questions SQL cannot: does `{ count: "exact" }` come back 0 when RLS
// filters a write (what mutated() relies on), which status and code does a
// refusal carry, does a forged id in the payload get through.
//
// It is a FALLBACK, like run.mjs (see README.md): there is no GoTrue — tokens
// are minted here — and the auth schema is bootstrap.sql's stand-in.
//
//   node scripts/pgtest/api.mjs
//   PGTEST_EXCLUDE=20261122100000_coach_write_scope.sql node scripts/pgtest/api.mjs
//       the same requests against the schema without the migration: every
//       rule it adds should then fail (this is how the script was checked)
//   PGRST_BIN=/path/to/postgrest node scripts/pgtest/api.mjs
//       use a PostgREST you already have (Windows / macOS: see bins.mjs)
import EmbeddedPostgres from "embedded-postgres";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { binary } from "./bins.mjs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const exclude = process.env.PGTEST_EXCLUDE ?? null;
const DB_PORT = Number(process.env.PGTEST_PORT ?? 54398);
const API_PORT = Number(process.env.PGTEST_API_PORT ?? 54397);
const JWT_SECRET = "pgtest-api-jwt-secret-at-least-32-characters";

// The client the app uses, from the repo's own node_modules (this directory is not a workspace).
const { PostgrestClient } = createRequire(path.join(REPO, "package.json"))("@supabase/postgrest-js");

// ---------- tokens: the claims Supabase puts in a session's access token ----------
const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
function jwt(claims) {
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return `${head}.${body}.${createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url")}`;
}
const API = `http://127.0.0.1:${API_PORT}`;
const anon = new PostgrestClient(API, { headers: { Authorization: `Bearer ${jwt({ role: "anon", aud: undefined })}` } });
const as = (sub) => new PostgrestClient(API, { headers: { Authorization: `Bearer ${jwt({ sub, role: "authenticated" })}` } });

// ---------- the cast (same roles as supabase/tests/coach_write_scope.test.sql) ----------
const U = (n) => `ca000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const C1 = U(1), C2 = U(2), M1 = U(11), M2 = U(12), S = U(13);
const REL_M1 = U(101), REL_M2 = U(102);
const CHECKIN = U(201), FEEDBACK = U(202), SESSION_M1 = U(203), SET_M1 = U(204), VIDEO = U(205), SESSION_M2 = U(206);
const PROGRAM = U(301), DRAFT = U(302), DAY = U(303), PEX = U(304), PLAN = U(305), MEAL = U(306), HABIT = U(307), EXERCISE = U(308);

const FIXTURES = `
insert into auth.users (id, email, raw_user_meta_data) values
  ('${C1}', 'api-coach@test.local', '{}'), ('${C2}', 'api-other@test.local', '{}'),
  ('${M1}', 'api-m1@test.local', '{}'), ('${M2}', 'api-m2@test.local', '{}'), ('${S}', 'api-s@test.local', '{}');
update public.users set role = 'coach' where id in ('${C1}', '${C2}');
insert into public.trainer_clients (id, coach_id, client_id, status, started_at) values
  ('${REL_M1}', '${C1}', '${M1}', 'active', now()), ('${REL_M2}', '${C1}', '${M2}', 'active', now());
insert into public.exercises (id, name_en) values ('${EXERCISE}', 'API Squat');
insert into public.check_ins (id, user_id, week_start, weight_kg, note) values ('${CHECKIN}', '${M1}', current_date, 70, 'tired');
insert into public.coach_feedback (id, coach_id, client_id, reference_type, reference_id, body)
  values ('${FEEDBACK}', '${C1}', '${M1}', 'check_in', '${CHECKIN}', 'Solid week');
insert into public.logged_sessions (id, user_id, started_at, completed_at, client_generated_id) values
  ('${SESSION_M1}', '${M1}', now() - interval '1 hour', now(), gen_random_uuid()),
  ('${SESSION_M2}', '${M2}', now() - interval '1 hour', null, gen_random_uuid());
insert into public.logged_sets (id, session_id, user_id, exercise_id, set_index, weight_kg, reps, client_generated_id)
  values ('${SET_M1}', '${SESSION_M1}', '${M1}', '${EXERCISE}', 1, 80, 5, gen_random_uuid());
insert into public.set_videos (id, logged_set_id, user_id, storage_path) values ('${VIDEO}', '${SET_M1}', '${M1}', 'videos/m1.mp4');
insert into public.programs (id, coach_id, client_id, name, status) values
  ('${PROGRAM}', '${C1}', '${M2}', 'Strength', 'published'), ('${DRAFT}', '${C1}', '${M2}', 'Unsent', 'draft');
insert into public.program_days (id, program_id, day_index, name) values ('${DAY}', '${PROGRAM}', 1, 'Upper A');
insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps)
  values ('${PEX}', '${DAY}', '${EXERCISE}', 0, 3, '8');
insert into public.nutrition_plans (id, coach_id, client_id, name, status, kcal_target)
  values ('${PLAN}', '${C1}', '${M2}', 'Cut', 'published', 2000);
insert into public.planned_meals (id, plan_id, slot, name) values ('${MEAL}', '${PLAN}', 'breakfast', 'Oats');
insert into public.habits (id, user_id, created_by, name) values ('${HABIT}', '${M1}', '${C1}', 'Walk 8k');
`;

// ---------- a tiny TAP, same output shape as run.mjs ----------
let n = 0, failed = 0;
function check(cond, desc, detail) {
  n++;
  if (cond) console.log(`ok ${n} - ${desc}`);
  else { failed++; console.log(`not ok ${n} - ${desc}${detail ? `  (${JSON.stringify(detail)})` : ""}`); }
}
const refused = (r) => r.error?.code === "42501";

// ---------- the scenarios ----------
async function scenarios(db) {
  const value = async (sql) => (await db.query(sql)).rows[0]?.v;

  // 1. coach_feedback: the client marks it read, nothing else
  let r = await as(M1).from("coach_feedback").update({ read_at: new Date().toISOString() }, { count: "exact" }).eq("id", FEEDBACK);
  check(!r.error && r.count === 1, "1. the client marks the coach's feedback read", r.error);
  r = await as(M1).from("coach_feedback").update({ body: "You are the best client ever" }).eq("id", FEEDBACK);
  check(refused(r), "1. the client cannot rewrite the feedback (42501)", r.error ?? r.status);
  r = await as(M1).from("coach_feedback").update({ coach_id: C2 }).eq("id", FEEDBACK);
  check(refused(r), "1. nor re-attribute it to another coach", r.error ?? r.status);
  r = await as(C2).from("coach_feedback").select("id");
  check(!r.error && r.data.length === 0, "1. the other coach sees no feedback under their name", r.data);
  check(await value(`select body as v from public.coach_feedback where id = '${FEEDBACK}'`) === "Solid week", "1. the stored words are the coach's");
  r = await as(C1).from("coach_feedback").insert({ coach_id: C1, client_id: S, reference_type: "check_in", reference_id: CHECKIN, body: "x" });
  check(refused(r), "1. a coach cannot file feedback for someone they do not coach", r.error ?? r.status);

  // 2. check_ins / set_videos: the coach stamps the review, the rest is the client's
  r = await as(C1).from("check_ins").update({ coach_reviewed_at: new Date().toISOString() }, { count: "exact" }).eq("id", CHECKIN);
  check(!r.error && r.count === 1, "2. the coach marks the check-in reviewed (the reviewCheckIn request)", r.error);
  r = await as(C1).from("check_ins").update({ weight_kg: 95 }).eq("id", CHECKIN);
  check(refused(r) && r.error?.message === "REVIEW_ONLY", "2. the coach cannot change the client's weight", r.error ?? r.status);
  r = await as(C2).from("check_ins").update({ coach_reviewed_at: null }, { count: "exact" }).eq("id", CHECKIN);
  check(!r.error && r.count === 0, "2. an unrelated coach reaches no row: count 0, which mutated() reports", r);
  r = await as(M1).from("check_ins").update({ note: "slept badly" }, { count: "exact" }).eq("id", CHECKIN);
  check(!r.error && r.count === 1, "2. the client still edits their own check-in", r.error);
  r = await as(M1).from("check_ins").update({ user_id: M2 }).eq("id", CHECKIN);
  check(refused(r), "2. the client cannot hand their check-in to someone else", r.error ?? r.status);
  r = await as(M1).from("check_ins").insert({ user_id: M2, week_start: "2026-01-05", weight_kg: 60 });
  check(refused(r), "2. nor file one under another user's id", r.error ?? r.status);
  check(Number(await value(`select weight_kg as v from public.check_ins where id = '${CHECKIN}'`)) === 70, "2. the stored weight is the client's");
  r = await as(C1).from("set_videos").update({ review_status: "reviewed" }, { count: "exact" }).eq("id", VIDEO);
  check(!r.error && r.count === 1, "2. the coach marks the set video reviewed", r.error);
  r = await as(C1).from("set_videos").update({ storage_path: "videos/elsewhere.mp4" }).eq("id", VIDEO);
  check(refused(r) && r.error?.message === "REVIEW_ONLY", "2. the coach cannot re-point the video", r.error ?? r.status);

  // 3. the coach's reach into a plan ends with the coaching
  r = await as(C1).from("program_days").update({ name: "Upper A (heavy)" }, { count: "exact" }).eq("id", DAY);
  check(!r.error && r.count === 1, "3. while coaching, the coach edits the client's day", r.error);
  r = await as(C1).rpc("coaching_transition", { p_relationship: REL_M2, p_to: "ended", p_reason: null });
  check(!r.error && r.data === "ended", "3. the coach ends the coaching (the transitionCoaching request)", r.error);
  r = await as(C1).from("programs").select("id").eq("client_id", M2);
  check(!r.error && r.data.length === 2, "3. the ex-coach still reads what they wrote", r.data ?? r.error);
  r = await as(C1).from("program_days").update({ name: "gone" }, { count: "exact" }).eq("id", DAY);
  check(!r.error && r.count === 0, "3. editing a day now reaches no row (count 0)", r);
  r = await as(C1).from("program_days").insert({ program_id: PROGRAM, week_index: 1, day_index: 2, name: "Sneaky" });
  check(refused(r), "3. adding a day is refused (42501, which inserted() reports)", r.error ?? r.status);
  r = await as(C1).rpc("duplicate_program_exercise", { p_row: PEX });
  check(refused(r), "3. duplicating an exercise through the RPC is refused", r.error ?? r.status);
  r = await as(C1).from("planned_meals").insert({ plan_id: PLAN, slot: "lunch", name: "Sneaky" });
  check(refused(r), "3. adding a meal to the client's plan is refused", r.error ?? r.status);
  r = await as(C1).from("programs").delete({ count: "exact" }).eq("id", PROGRAM);
  check(!r.error && r.count === 0, "3. deleting the published program reaches no row", r);
  r = await as(C1).from("nutrition_plans").delete({ count: "exact" }).eq("id", PLAN);
  check(!r.error && r.count === 0, "3. nor the published nutrition plan", r);
  r = await as(C1).from("programs").delete({ count: "exact" }).eq("id", DRAFT);
  check(!r.error && r.count === 1, "3. an unsent draft is still the coach's to delete", r.error);
  check(await value(`select count(*)::int as v from public.programs where id = '${PROGRAM}'`) === 1
        && await value(`select name as v from public.program_days where id = '${DAY}'`) === "Upper A (heavy)",
    "3. the client's program and day are as the coach left them while coaching");

  // 4. a set goes only into the logger's own session
  const set = (session) => ({ session_id: session, user_id: M2, exercise_id: EXERCISE, set_index: 1, weight_kg: 100, reps: 5,
    client_generated_id: crypto.randomUUID() });
  r = await as(M2).from("logged_sets").insert(set(SESSION_M2));
  check(!r.error && r.status === 201, "4. a set goes into the logger's own session", r.error);
  r = await as(M2).from("logged_sets").insert(set(SESSION_M1));
  check(refused(r), "4. but not into another person's session", r.error ?? r.status);
  r = await as(S).from("logged_sessions").insert({ user_id: S, program_day_id: DAY, started_at: new Date().toISOString(), client_generated_id: crypto.randomUUID() });
  check(refused(r), "4. nor can a stranger file a session under someone's private program day", r.error ?? r.status);

  // 5. macro targets
  r = await as(S).from("nutrition_plans").insert({ coach_id: null, client_id: S, name: "Mine", status: "published", kcal_target: 2000, protein_target_g: -5 });
  check(r.error?.code === "23514", "5. a negative macro target is refused by the table (23514)", r.error ?? r.status);
  r = await as(S).from("nutrition_plans").insert({ coach_id: null, client_id: S, name: "Mine", status: "published", kcal_target: 10000, carbs_target_g: 2500 });
  check(!r.error && r.status === 201, "5. the largest target the app can derive is accepted", r.error);

  // 6. habit ticks
  const tick = (user) => ({ habit_id: HABIT, user_id: user, date: new Date().toISOString().slice(0, 10), client_generated_id: crypto.randomUUID() });
  r = await as(C1).from("habit_logs").insert(tick(C1));
  check(refused(r), "6. the coach who set the habit cannot tick the client's day", r.error ?? r.status);
  r = await as(S).from("habit_logs").insert(tick(S));
  check(refused(r), "6. nor can a stranger", r.error ?? r.status);
  r = await as(M1).from("habit_logs").insert(tick(M1));
  check(!r.error && r.status === 201, "6. the client ticks their coach-set habit (the toggleHabit request)", r.error);

  // 7. anonymous callers
  r = await anon.rpc("admin_set_tier", { target_user: M1, new_tier: "premium" });
  check(refused(r), "7. anon cannot call admin_set_tier at all (42501)", r.error ?? r.status);
  r = await as(M1).rpc("admin_set_tier", { target_user: M1, new_tier: "premium" });
  check(r.error?.message === "FORBIDDEN", "7. a signed-in client is refused inside it", r.error ?? r.status);
  r = await anon.from("coach_feedback").select("id");
  check(refused(r), "7. anon reads no coach feedback", r.error ?? r.status);
}

// ---------- run ----------
const pg = new EmbeddedPostgres({
  databaseDir: mkdtempSync(path.join(tmpdir(), "pgapi-")), user: "postgres", password: "postgres", port: DB_PORT,
  persistent: false, createPostgresUser: process.getuid?.() === 0, initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
await pg.initialise();
await pg.start();
const db = pg.getPgClient();
await db.connect();
let api;
try {
  // bootstrap.sql, plus the one Supabase default it does not mirror: functions
  // created by postgres in public are granted to anon / authenticated as well,
  // so a migration that revokes only "from public" leaves anon a way in.
  await db.query(readFileSync(path.join(HERE, "bootstrap.sql"), "utf8"));
  await db.query("alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role");
  await db.query('set search_path = "$user", public, extensions');
  const migrations = readdirSync(path.join(REPO, "supabase/migrations")).filter((f) => f.endsWith(".sql") && f !== exclude).sort();
  for (const f of migrations) await db.query(readFileSync(path.join(REPO, "supabase/migrations", f), "utf8"));
  console.log(`applied ${migrations.length} migrations${exclude ? ` (without ${exclude})` : ""}`);
  // the role PostgREST logs in as and switches from, as on Supabase
  await db.query("create role authenticator login noinherit password 'authenticator'; grant anon, authenticated, service_role to authenticator");
  await db.query(FIXTURES);

  api = spawn(await binary("postgrest"), [], {
    env: {
      PGRST_DB_URI: `postgres://authenticator:authenticator@127.0.0.1:${DB_PORT}/postgres`,
      PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_DB_EXTRA_SEARCH_PATH: "public,extensions",
      PGRST_JWT_SECRET: JWT_SECRET, PGRST_SERVER_PORT: String(API_PORT), PGRST_SERVER_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try { ready = (await fetch(`${API}/`)).ok; } catch { /* not up yet */ }
    if (!ready) await new Promise((res) => setTimeout(res, 200));
  }
  if (!ready) throw new Error("PostgREST did not come up");

  await scenarios(db);
} catch (e) {
  failed++;
  console.log(`ERROR ${String(e.message).slice(0, 300)}`);
} finally {
  api?.kill();
  await db.end();
  await pg.stop();
}
console.log(failed ? `\n${failed} failures` : `\nall green (${n} checks through PostgREST)`);
process.exit(failed ? 1 : 0);
