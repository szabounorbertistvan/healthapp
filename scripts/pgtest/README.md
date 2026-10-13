# Offline pgTAP runner

Applies every file in `supabase/migrations` to a throwaway Postgres and runs
every suite in `supabase/tests` — **without Docker**.

`npm run db:test` shells out to `supabase test db`, which needs `supabase
start`, which needs Docker. This repo is largely written on a Windows box that
has none, and "I could not run the RLS tests" is how a policy bug reaches
production. So: `embedded-postgres` downloads a real Postgres into
`scripts/pgtest/node_modules`, this script bootstraps just enough Supabase
around it, and the suites run unmodified.

## Use

```bash
cd scripts/pgtest && npm install
```

That first install downloads a Postgres build (~100 MB) and takes a few
minutes. It is why this directory has its own `package.json` and is **not** an
npm workspace — nobody running `npm install` at the repo root pays for it.

Then, from the repo root:

```bash
npm run db:test:offline
```

Or one suite at a time — the argument is a substring of the file name:

```bash
node scripts/pgtest/run.mjs program_library
```

Output is one line per suite, plus the text of anything that failed:

```
applied 42 migrations
ok    account_purge.test.sql  (9 passed, 0 failed)
FAIL  program_library.test.sql  (23 passed, 1 failed)
      not ok 12 - a stranger cannot copy a private program (have: 0, want: 1)
```

Exit code is the number of failures, so it works in a `&&` chain.

## What it is not

**CI remains the source of truth.** `.github/workflows/ci.yml` runs these same
suites against a real Supabase stack with real pgTAP. This harness is a fast
local check, and it differs in ways that matter:

- **`pgtap--0.1.sql` is a stand-in, not pgTAP.** Real pgTAP is a C extension
  that cannot be installed into the downloaded binaries, so the assertions used
  by this repo's suites (`plan`, `ok`, `is`, `isnt`, `throws_ok`, `lives_ok`,
  `cmp_ok`, `set_eq`, `has_table`, `has_column`, `has_function`, `finish`) are
  reimplemented in plpgsql with the same names, argument orders and TAP output.
  A suite that reaches for an assertion not implemented here fails with
  `function <name>(...) does not exist` — add it to that file.
- **`bootstrap.sql` is a stand-in for the Supabase auth schema.** `auth.users`
  carries only the columns the migrations and the admin panel actually read,
  and `auth.uid()` reads `request.jwt.claims` the way the real one does. There
  is no GoTrue, so nothing that depends on an actual sign-in is exercised.
- **No `pg_cron`, `pg_net` or `vault`.** The migrations already guard for their
  absence; anything gated behind them is simply not run here.
- **No PostgREST in `run.mjs`.** These are SQL-level tests. RLS is exercised by
  setting the `authenticated` role and a JWT claim, which is what the suites do
  anyway. `api.mjs` (below) covers the HTTP layer for the write-scope rules.
- **Function grants are not mirrored by `bootstrap.sql`.** Supabase also grants
  EXECUTE on every new public function to anon / authenticated / service_role,
  so a migration that revokes only `from public` passes here and is still
  callable by anon live: always name `anon` in the revoke. `api.mjs` adds that
  default, and the full suite was checked green with it (2026-10-13).

## Through PostgREST: `api.mjs`

```bash
npm run db:test:api
```

The same embedded Postgres, then a real PostgREST (v16.1, the version the
repo's Supabase CLI starts in Docker; downloaded once into `scripts/pgtest/.bin/`,
SHA-256 pinned in `bins.mjs` — set `PGRST_BIN` on Windows / macOS) logged in as `authenticator`, JWTs signed with
Supabase's claims, and requests built by `@supabase/postgrest-js` — what every
`supabase.from(...)` in the app sends. It checks the rules of
`20261122100000_coach_write_scope` as HTTP sees them: refusals as 42501, an
RLS-filtered write as `count: 0` (what `mutated()` reads), forged ids in a
payload, and the legitimate request beside each refusal.
`PGTEST_EXCLUDE=<migration file>` runs it without one migration — every rule
that migration adds should then fail. No GoTrue: tokens are minted here.

## Files

| File | |
|---|---|
| `run.mjs` | starts the server, applies migrations, runs the suites, counts `not ok` |
| `api.mjs` | the same, plus PostgREST: the write-scope rules over HTTP |
| `stack.mjs` | a whole local Supabase for `e2e-local/` (`npm run e2e:stack`): Postgres + GoTrue + PostgREST + gateway on 127.0.0.1:54430–54433 |
| `stack-env.mjs` | the stack's fixed local addresses and keys (no dependencies) |
| `bins.mjs` | PostgREST v16.1 / GoTrue v2.195.0 — the CLI's own versions — downloaded once, SHA-256 pinned |
| `bootstrap.sql` | roles, schemas, stub `auth`, `auth.uid()` |
| `pgtap--0.1.sql` | the stub assertions, installed as a Postgres extension |

## Gotchas that cost a rebuild each

Kept here because all three fail in ways that do not name their cause:

- **`initdbFlags: ["--encoding=UTF8", "--locale=C"]` is mandatory.** Without it
  initdb picks the system codepage and the first migration containing a
  Romanian diacritic dies with *"character with byte sequence 0xc4 0x83 …
  has no equivalent in encoding WIN1252"*.
- **`set search_path` must run on the open connection.** `alter database … set
  search_path` in `bootstrap.sql` only reaches *new* sessions, so the
  already-connected client never sees the `extensions` schema and every suite
  fails with `function plan(integer) does not exist`.
- **Record the migrations.** `admin_system_health()` reads
  `supabase_migrations.schema_migrations`; applying the files directly leaves it
  empty and that one assertion fails for no visible reason.
