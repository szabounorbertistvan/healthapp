# Migration gate

`scripts/migration-gate.mjs` (`npm run db:gate`), rules in `scripts/lib/migration-gate.mjs`,
tested in `scripts/lib/migration-gate.test.mjs`. Read-only: it reads files and git, never a database.

## Why

Three incidents it is shaped by: code deployed before its migration was live (`/today`
on 15.10, 13 errors for one account, cause probable but not proven — see the investigation
of 16.10); migrations applied by hand and only marked in the ledger, so the ledger carries
no SQL (`20261125100000`, `20261125110000`, `20261128100000`); and a migration that existed
on production with **no file in any git object** (`20261128100000_goal_plan_limit` — the author's
original file arrived in 15bc976 on 16.10; a reconstruction from production's catalog, made the
same day before it was found, matched it in effect).

## What runs where

| Where | Command | Fails on |
|---|---|---|
| CI (`ci.yml`, job *check*, before install) on every push to `main` and every PR | `node scripts/migration-gate.mjs --base <commit before the push / PR base>` | a `.sql` file not named `<14 digits>_<snake_case>.sql`; two files with one version; a migration already on the base **modified, deleted or renamed**; a new migration **older** than the newest on the base (a plain `db push` refuses it) |
| By hand, before every release that ships a migration or code needing one | `npm run db:gate -- --remote ledger.txt` | a version on production with no file here; a version here not yet applied on production |

`ledger.txt` is the read-only output of `npx.cmd supabase migration list --linked`
(table or JSON), or the SQL editor's
`select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;`.
Only the **Remote** column is read — the CLI prints the Local column beside it, and until
16.10 `scripts/lib/migration-diff.mjs` read both, which hid every pending migration.

A reviewed exception (e.g. a file renamed before it was ever applied) goes in
`supabase/migration-gate.json`: `{"allow": {"<version>": "<why>"}}`, in the same change.

## Publishing order

1. `npm run db:backup` (read-only `pg_dump` of the live project; the CLI mints a short-lived
   login role for it, as it does for `db query` / `db dump`).
2. `npx.cmd supabase migration list --linked > ledger.txt` and `npm run db:gate -- --remote ledger.txt`:
   the pending list is what the push will apply; a remote-only version must be resolved first.
3. `npx.cmd supabase db push` (add `--include-all` only when the gate says a pending version is
   older than the newest remote one).
4. The ledger again: `--remote` must now be clean.
5. Only then push the code to `main` (Vercel deploys it on its own).

`db push` stops, applying nothing more, when:
- a version is on the remote with no local file (until 15bc976: `20261128100000`);
- a pending version is older than the newest remote one (needs `--include-all`);
- a migration fails — that file is not recorded in the ledger and the push stops there; files
  applied before it in the same push stay applied (check with `migration list`);
- the CLI is not logged in or not linked to the project, or the database password is refused;
- an object a migration creates already exists because it was applied by hand without being
  recorded (a non-idempotent `create`). The ledger cannot show this; `--remote` cannot either.

## Vercel: what the repository shows

- There are two `vercel.json`. Commits `b382bb7` and `fce15c1` (2026-09-06) record that the
  project's **Root Directory was set to `apps/web`**, which makes Vercel read
  `apps/web/vercel.json` (build `next build`, ignore step `npx turbo-ignore @healthapp/web`,
  output `.next`, region fra1) and ignore the root file. Confirmed in the dashboard on
  2026-10-19: Root Directory `apps/web`, the production build runs `next build` → `.next`.
- The Node version is not pinned in the repository (no `engines`, no `.nvmrc`): Vercel uses the
  project setting (24.x, seen 2026-10-19), and every workflow uses Node 24 to match.
- Vercel builds `main` on its own, and CI runs beside it. Since 2026-10-19 the last CI job,
  *Vercel gate*, needs the other three (*Typecheck, lint, tests, build*, whose first step is
  the migration gate; *Edge functions (deno check)*; *RLS policies (pgTAP)*) and posts one
  commit status, **`Vercel - healthapp: ci`**: success only when all three passed, failure
  otherwise. It runs on pushes only (Deployment Checks gate Production, which only `main`
  builds), with `statuses: write` on that job alone. The status is written with `gh api`, not
  `vercel/repository-dispatch/actions/status@v1`: that action finds "its" job by run id only,
  so in a run with several jobs it reports whichever job GitHub lists first. There is no
  `repository_dispatch` trigger: Vercel's docs make it optional when the check runs on push,
  and it would run CI a second time per push inside the same concurrency group.
- Making Vercel wait is a project setting, once that status has appeared on a `main` commit:
  Settings → Build and Deployment → Deployment Checks → Add Checks → GitHub → select
  `Vercel - healthapp: ci`. Production deployments are then still built, but assigned to
  www.voinic.fit only after the status is success; *Force Promote* on a deployment bypasses it.
  Not configured as of 2026-10-19.

## What it cannot do

- **It blocks Vercel only through the dashboard setting.** Vercel builds `main` on its own;
  a red gate holds the Production promotion only once `Vercel - healthapp: ci` is a required
  Deployment Check (above). Until then a red gate tells you, it does not stop the deploy.
- **It does not see production in CI.** CI has no credentials for the live project, by
  design, so "is this migration applied?" is only answered by the `--remote` run, by a person.
- **It cannot tell which code needs which migration.** The rule stays the project's:
  migrations live before pushing code that needs them; `--remote` must be clean before a release.
- A push that creates a branch or follows a force push has no usable base: the history
  check is skipped with a notice; the name checks still run.
