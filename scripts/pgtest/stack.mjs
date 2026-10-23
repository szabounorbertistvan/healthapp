// A local Supabase for the local E2E suite (e2e-local/), without Docker.
//
// `supabase start` is the real thing and what CI should run (see
// e2e-local/README.md). This is the same fallback idea as run.mjs for a box
// with no Docker: the real services, at the versions the repo's Supabase CLI
// pins (bins.mjs), wired the way Supabase wires them —
//
//   embedded Postgres  ← GoTrue v2.195.0 builds the real `auth` schema itself
//                      ← every file in supabase/migrations, then supabase/seed/e2e.sql
//   PostgREST v16.1     logged in as `authenticator`, switching to anon / authenticated
//   a gateway           /auth/v1 → GoTrue, /rest/v1 → PostgREST, with CORS (Kong's job)
//
// Everything is throwaway: a fresh database per start, nothing persisted, and
// it listens on 127.0.0.1 only. The JWT secret below is local-only and public,
// like the demo keys `supabase start` prints; it signs nothing anywhere else.
//
//   node scripts/pgtest/stack.mjs          start; prints the env; runs until Ctrl+C
//
// Ports (not the CLI's 5432x, so both can run side by side):
//   54430 Postgres · 54431 GoTrue · 54432 PostgREST · 54433 gateway (the "Supabase URL")
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import http from "node:http";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { binary } from "./bins.mjs";
import { ANON_KEY, APP_URL, SERVICE_KEY, STACK as PORTS, SUPABASE_URL } from "./stack-env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

const STACK = { ...PORTS, siteUrl: process.env.E2E_SITE_URL ?? APP_URL };

// What Supabase's Postgres image sets up before GoTrue or any migration runs:
// the API roles, the extensions schema, and the default grants every new table,
// sequence and function in `public` receives (verified live for tables,
// 2026-10-05; see bootstrap.sql and README.md for functions).
const PRE_AUTH = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit password 'authenticator';
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
alter database postgres set search_path = "$user", public, extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant usage, select, update on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
`;
// After GoTrue: what the image grants on its auth schema.
const POST_AUTH = `
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
`;

function waitFor(url, label, tries = 150) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http.get(url, (res) => { res.resume(); resolve(); }).on("error", () => {
        if (n <= 0) reject(new Error(`${label} did not come up at ${url}`));
        else setTimeout(() => attempt(n - 1), 200);
      });
    };
    attempt(tries);
  });
}

function run(bin, args, env, label) {
  const child = spawn(bin, args, { env: { PATH: process.env.PATH, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const tail = [];
  const keep = (d) => { tail.push(String(d)); if (tail.length > 40) tail.shift(); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.on("exit", (code) => { if (code && !stopping) console.error(`[stack] ${label} exited ${code}\n${tail.join("")}`); });
  return child;
}

/** Kong's part: route by prefix, answer CORS (the browser client calls GoTrue directly). */
function gateway() {
  const routes = [["/auth/v1", STACK.gotruePort], ["/rest/v1", STACK.restPort]];
  const cors = (req) => ({
    "access-control-allow-origin": req.headers.origin ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
    "access-control-expose-headers": "content-range, x-total-count, content-profile",
  });
  return http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
    if (req.method === "OPTIONS") { res.writeHead(204, cors(req)); res.end(); return; }
    const route = routes.find(([prefix]) => req.url.startsWith(prefix + "/") || req.url === prefix);
    if (!route) { res.writeHead(404, cors(req)); res.end(JSON.stringify({ message: "not served by the local stack" })); return; }
    const [prefix, port] = route;
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    // Kong turns the apikey into the bearer when a request carries no session.
    if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
    const upstream = http.request({ host: "127.0.0.1", port, method: req.method, path: req.url.slice(prefix.length) || "/", headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, { ...up.headers, ...cors(req) });
      up.pipe(res);
    });
    upstream.on("error", (e) => { res.writeHead(502, cors(req)); res.end(JSON.stringify({ message: e.message })); });
    req.pipe(upstream);
  });
}

let stopping = false;
export async function startStack({ log = console.log } = {}) {
  const children = [];
  const pg = new EmbeddedPostgres({
    databaseDir: mkdtempSync(path.join(tmpdir(), "voinic-e2e-")), user: "postgres", password: "postgres",
    port: STACK.dbPort, persistent: false, createPostgresUser: process.getuid?.() === 0,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  await pg.initialise();
  await pg.start();
  const db = pg.getPgClient();
  await db.connect();
  await db.query(PRE_AUTH);

  // Sessions are signed ES256, as on the live project (its JWKS publishes one
  // P-256 key). With HS256 tokens supabase-js's getClaims() cannot verify
  // locally and falls back to GET /auth/v1/user — which this GoTrue answers in
  // ~0.75 s, on every middleware pass and every render — so the app here was
  // several times slower than in production for a reason production does not
  // have (docs/PERFORMANCE.md). A fresh key per start; the fixed anon and
  // service keys stay HS256 under jwtSecret, which both servers still accept.
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = randomUUID();
  const signingKey = { ...privateKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig", key_ops: ["sign", "verify"] };
  const { d: _d, ...publicKey } = signingKey;
  const jwks = { keys: [{ ...publicKey, key_ops: ["verify"] }, { kty: "oct", k: Buffer.from(STACK.jwtSecret).toString("base64url"), alg: "HS256" }] };

  // GoTrue: migrate (it creates and owns the auth schema), then serve
  const gotrueBin = await binary("gotrue");
  const gotrueEnv = {
    GOTRUE_DB_DRIVER: "postgres",
    DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${STACK.dbPort}/postgres?sslmode=disable&search_path=auth`,
    GOTRUE_DB_MIGRATIONS_PATH: path.join(path.dirname(gotrueBin), "migrations"),
    GOTRUE_API_HOST: "127.0.0.1", PORT: String(STACK.gotruePort), API_EXTERNAL_URL: `${SUPABASE_URL}/auth/v1`,
    GOTRUE_SITE_URL: STACK.siteUrl, GOTRUE_URI_ALLOW_LIST: `${STACK.siteUrl}/**`,
    GOTRUE_JWT_SECRET: STACK.jwtSecret, GOTRUE_JWT_KEYS: JSON.stringify([signingKey]),
    GOTRUE_JWT_EXP: "3600", GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated", GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_DISABLE_SIGNUP: "false", GOTRUE_EXTERNAL_EMAIL_ENABLED: "true", GOTRUE_MAILER_AUTOCONFIRM: "true",
    // no mail server here: recovery links are minted through the admin API by the tests
    GOTRUE_RATE_LIMIT_EMAIL_SENT: "1000", GOTRUE_RATE_LIMIT_VERIFY: "1000", GOTRUE_RATE_LIMIT_TOKEN_REFRESH: "1000",
    GOTRUE_RATE_LIMIT_OTP: "1000", GOTRUE_RATE_LIMIT_ANONYMOUS_USERS: "1000", GOTRUE_LOG_LEVEL: "warn",
  };
  await new Promise((resolve, reject) => {
    const m = run(gotrueBin, ["migrate"], gotrueEnv, "gotrue migrate");
    m.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`gotrue migrate exited ${code}`))));
  });
  await db.query(POST_AUTH);

  // the app's schema, recorded the way `supabase db push` records it, then the E2E seed
  await db.query('set search_path = "$user", public, extensions');
  const migrations = readdirSync(path.join(REPO, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const f of migrations) {
    try { await db.query(readFileSync(path.join(REPO, "supabase/migrations", f), "utf8")); }
    catch (e) { throw new Error(`migration ${f}: ${e.message}`); }
    await db.query("insert into supabase_migrations.schema_migrations (version) values ($1) on conflict do nothing", [f.split("_")[0]]);
  }
  log(`[stack] applied ${migrations.length} migrations`);
  // STACK_EXTRA_SEEDS (comma-separated files of supabase/seed/) go in before e2e.sql:
  // the soak suite (scripts/soak.mjs) adds usda-foods.sql so its trio can search and log food
  const extra = (process.env.STACK_EXTRA_SEEDS ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  for (const seed of ["exercises.sql", ...extra, "e2e.sql"]) {
    await db.query("select set_config('voinic.e2e', 'on', false)");
    await db.query(readFileSync(path.join(REPO, "supabase/seed", seed), "utf8"));
  }
  log(`[stack] seeded exercises${extra.map((f) => ` + ${f}`).join("")} + e2e accounts`);
  await db.end();

  children.push(run(gotrueBin, ["serve"], gotrueEnv, "gotrue"));
  children.push(run(await binary("postgrest"), [], {
    PGRST_DB_URI: `postgres://authenticator:authenticator@127.0.0.1:${STACK.dbPort}/postgres`,
    PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_DB_EXTRA_SEARCH_PATH: "public,extensions",
    PGRST_JWT_SECRET: JSON.stringify(jwks), PGRST_SERVER_PORT: String(STACK.restPort), PGRST_SERVER_HOST: "127.0.0.1",
    PGRST_DB_MAX_ROWS: "1000",
  }, "postgrest"));
  const gw = gateway();
  await new Promise((resolve) => gw.listen(STACK.gatewayPort, "127.0.0.1", resolve));
  await waitFor(`http://127.0.0.1:${STACK.gotruePort}/health`, "GoTrue");
  await waitFor(`http://127.0.0.1:${STACK.restPort}/`, "PostgREST");
  log(`[stack] ready at ${SUPABASE_URL}`);

  return async function stop() {
    stopping = true;
    gw.close();
    children.forEach((c) => c.kill());
    await pg.stop();
  };
}

// started directly: run until interrupted, and leave the env where the suite reads it
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stop = await startStack();
  const env = { NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY, E2E_SUPABASE_SERVICE_KEY: SERVICE_KEY };
  mkdirSync(path.join(HERE, ".stack"), { recursive: true });
  writeFileSync(path.join(HERE, ".stack", "env"), Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  console.log(Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n"));
  const shutdown = async () => { await stop(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  setInterval(() => {}, 1 << 30);
}
