# Local E2E suite

End-to-end tests of the real app against a **throwaway, local** Supabase, with
accounts and data of its own. `e2e/` reads the live project with the shared
test accounts and must stay read-only. This suite writes: it creates and
deletes programs and plans, sends and cancels coaching requests, and resets a
password. That is why it may only ever run on this machine.

```bash
npm run e2e:local
```

With nothing configured this:
1. starts the Docker-less stack: `scripts/pgtest/stack.mjs`, run as `npm run e2e:stack`. It is embedded Postgres, then **GoTrue v2.195.0**, which builds the real `auth` schema, then every migration, then `supabase/seed/exercises.sql` and `supabase/seed/e2e.sql`, then **PostgREST v16.1** and a gateway on `127.0.0.1:54433`. These are the versions the repo's Supabase CLI runs in Docker.
2. makes a production build of the app pointed at that stack, and starts it on `http://localhost:3210` (not 3100: that is the `web-prod` launch entry, wired to the live project). Live-service keys a developer keeps in `apps/web/.env.local` (service role, Stripe, Cloudinary, Places, analytics, push) are blanked for this build;
3. signs each seeded account in through the real login form (`auth.setup.ts`), then runs the specs.

One-time setup: `cd scripts/pgtest && npm install`, plus `npx playwright install chromium`. The binaries download on first use and are checked against pinned SHA-256s. On Windows or macOS, set `PGRST_BIN` / `GOTRUE_BIN` (see `scripts/pgtest/bins.mjs`).

## It cannot write to production

Four layers, each tested:

- **Addresses.** `target.ts` (rules in `scripts/lib/local-target.mjs`, unit-tested
  by `npm test`) stops the run at config load unless the Supabase URL and the app
  URL are loopback — no look-alike hosts, no userinfo tricks — and unless
  `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL`, if set in the shell, are local too.
  A key carrying a hosted project's `ref` claim is refused even with a local URL.
- **No adopted server.** The config never reuses an app already listening on its
  port (it could be wired to the live project): a busy port fails the run.
- **A network fence in every browser context** (`fixtures.ts`): any request
  leaving this machine is aborted, and a page, fetch or websocket that tried
  fails the test. `guard.spec.ts` proves it from inside a browser and checks that
  signing in only talks to the local GoTrue.
- **Local keys only.** The service-role key the specs use to check and clean the
  database is the stack's own; the app itself gets none.

The seed refuses to run unless the session set `voinic.e2e = on`, so pasting
it into a real project's SQL editor changes nothing.

## What it covers

| Spec | Flows | Backend checked |
|---|---|---|
| `guard.spec.ts` | a request to a hosted Supabase is blocked in the browser and reported; sign-in talks to the local GoTrue only | — |
| `auth.spec.ts` | deep link → sign in → back; wrong password; open redirect in `?next`; expired session with a revoked refresh token; tampered cookie; full password reset through `/auth/callback` (link works once) | GoTrue (the real one) |
| `discovery.spec.ts` | directory, search, city filter, refresh; public profile (no e-mail, no account id in the HTML); draft and unknown slug = 404; landing page's discovery section (published coach, never the draft); robots.txt, sitemap (no draft), canonical, noindex, JSON-LD without private fields; Save signed out → sign in → back, saved once; Contact → sign in → back; request → pending → stale second tab refused → cancel | `coaching_requests`, `coach_saves` rows |
| `isolation.spec.ts` | two coaches, two clients: rosters; coach B → coach A's client / program / plan by URL = 404; client B → client A's program / workout day; ended and paused relationships: the program and plan editors are read-only with a notice, nothing changed; an editor left open while the relationship is paused: the write is refused **with a message**, then the notice appears; the active coach edits normally | row counts before and after |
| `programs.spec.ts` | create (double-click → one program) → day → exercise → edit → reload; a dropped connection mid-action → message, editor stays, nothing written → retry works | `programs`, `program_days`, `program_exercises` |
| `nutrition.spec.ts` | create (double-click → one plan) with its four meal slots → reload; out-of-range targets refused; a **real** meal-slot failure → error shown, no half plan left; dropped connection → message → retry makes one plan | `nutrition_plans`, `planned_meals` |

**Data isolation:** each account belongs to one concern, and a spec creates
only rows named with its run tag (`RUN` in `accounts.ts`) and removes them in
`afterAll`/`afterEach`. Specs run in parallel and can run on a stack that
earlier runs have used.

**Not mocked:** sign-in, sessions, RLS, PostgREST, the database and its
triggers. Two things are produced on purpose:
- a **dropped connection** is the browser aborting the server-action request (`helpers.ts`);
- the **meal-slot failure** is a trigger that exists only in the E2E seed and fires for a plan named `[e2e:fail-meals]`.

Both exercise the app's real error paths.

## CI

`.github/workflows/e2e-local.yml` runs exactly this on GitHub's runner (manual
trigger, no secrets). To make it a PR gate, add `pull_request:` to its `on:`.
That is a decision about time per PR (a production build plus the stack, about
5 minutes) and flakiness tolerance, so it is left to the owner.

**Alternative with Docker:** `supabase start`, then
`psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "set voinic.e2e = on" -f supabase/seed/exercises.sql -f supabase/seed/e2e.sql`,
build and start the app against `http://127.0.0.1:54321` with the anon key
`supabase status -o env` prints, then run:

```bash
E2E_SUPABASE_URL=http://127.0.0.1:54321 \
E2E_SUPABASE_ANON_KEY=… E2E_SUPABASE_SERVICE_KEY=… \
E2E_LOCAL_BASE_URL=http://localhost:3210 \
npm run e2e:local
```

This path has not been run yet: the machine this was written on has no Docker.
`config.toml`'s `[auth]` must then allow `http://localhost:3210/**` as a redirect URL.

## The soak suite

`e2e-local/soak/` runs on the same stack and guard but is not part of `npm run e2e:local`:
`npm run e2e:soak` plays a coach, their client and a solo trainee against each other in a loop.
See [soak/README.md](soak/README.md).

## Machine notes

- A sandbox whose preinstalled Chromium is not the build this Playwright pins can set `E2E_CHROMIUM_PATH`.
- Next redirects to `localhost` even when called on `127.0.0.1`, and cookies are per host. Keep the app URL on `localhost`.
- **Windows (run here 2026-10-16).** `bins.mjs` downloads Linux binaries only, so point it at
  Windows ones (kept in the gitignored `.tools/gotrue/auth.exe` + `migrations/` and `.tools/postgrest/postgrest.exe`, where `npm run e2e:soak` finds them): `PGRST_BIN` = PostgREST v16.1 `postgrest-v16.1-windows-x86-64.zip` (official
  release, SHA-256 `ae4b3dca…2e87`), and put
  `scripts/pgtest/node_modules/@embedded-postgres/windows-x64/native/bin` on `PATH` — it carries
  the `libpq.dll` PostgREST needs (without it the exe dies with 0xC0000135). `GOTRUE_BIN` = GoTrue
  v2.195.0 built from source with Go ≥ 1.25.12 (`go build -o auth.exe .` in the release tarball, with
  `migrations/` beside the exe); Windows has no `SO_REUSEPORT`, so `cmd/serve_cmd.go`'s
  `ListenConfig.Control` must be dropped in that local copy. A run that is killed can leave a
  `postgres.exe` child holding the stack's port 54430 and a PostgREST on 54432 — the next run then
  fails with "PostgREST did not come up" (exit 3); stop those first.
- `E2E_DIAG_STREAM=1` adds a probe of React's streaming (segment containers, `$RC`/`$RV` calls, RSC
  requests) to every page of the test's own context and writes `stream-timeline.txt` next to a test
  that ends with a `div[hidden][id^="S:"]` still in the DOM. Off by default; docs/GAPS.md explains why.
