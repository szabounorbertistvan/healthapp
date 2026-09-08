# HealthApp — Database & Backend

Supabase (Postgres) schema implementing [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) §4 and the
permission matrix from [PRODUCT_SPEC.md](../PRODUCT_SPEC.md) §4.

## Layout

```
supabase/
├── config.toml                     # local stack (supabase start / db reset)
├── migrations/
│   ├── 20260823000100_types.sql        # extensions, enums, shared triggers
│   ├── 20260823000200_core.sql         # users, trainer_clients (invites), goals, RLS helpers
│   ├── 20260823000300_training.sql     # exercises, programs, logged sessions/sets, videos, events
│   ├── 20260823000400_nutrition.sql    # foods cache, nutrition plans, food logs (macro snapshots)
│   ├── 20260823000500_progress.sql     # measurements, check-ins, photos, adherence snapshots
│   ├── 20260823000600_coaching.sql     # conversations, messages, polymorphic coach feedback
│   ├── 20260823000700_engagement.sql   # habits, streaks, badges (+MVP catalog), notifications
│   ├── 20260823000800_rls.sql          # every RLS policy — mirrors the permission matrix 1:1
│   ├── 20260823000900_functions.sql    # invites, coach_dashboard, adherence engine v1, GDPR export, pg_cron
│   ├── 20260823001000_admin_role.sql   # internal admin role
│   ├── 20260823001100_subscriptions.sql# tiers + server-enforced client limit
│   └── 20260823001200_deletion_and_jobs.sql # account deletion, streak-risk + check-in-due jobs
├── functions/
│   ├── food-search/       # local cache → Open Food Facts search; caches hits into `foods`
│   ├── barcode-lookup/    # cache → OFF product API; 404 = "not found, offer search/custom"
│   ├── import-exercises/  # one-shot import of Free Exercise DB (873 exercises, public domain)
│   ├── sync-ingest/       # offline outbox flush; idempotent on client_generated_id (spec §5)
│   └── push-dispatch/     # notifications → Expo Push; quiet hours + per-category prefs (spec §8)
└── tests/                 # pgTAP; `npm run db:test` — RLS is a launch gate (spec §11)
```

## External data sources (both free)

| Source | Used for | How |
|---|---|---|
| **Open Food Facts** | Food search + barcode lookup | Free API, called at request time by the two edge functions; every hit is cached into `foods` so repeat searches are local. Requires a `User-Agent` header (already set — update the contact before launch). License: ODbL — attribution required in the app ("Food data from Open Food Facts"). |
| **Free Exercise DB** | System exercise library | Public-domain JSON (873 exercises with instructions + images) pulled by `import-exercises`, upserted idempotently as system rows (`owner_id null`). Images hot-link to the project's GitHub raw URLs — mirror them into Supabase Storage before production. Romanian names (`name_ro`) are empty; translate top ~200 before beta. |

## Getting started

```bash
# 1. install the CLI:  https://supabase.com/docs/guides/cli
supabase init                 # once, in repo root (creates config.toml)
supabase start                # local stack (Docker)
supabase db reset             # applies all migrations to the local DB

# 2. deploy to a hosted project
supabase link --project-ref <your-project-ref>
supabase db push              # applies migrations
supabase functions deploy food-search barcode-lookup import-exercises

# 3. load the exercise library (once, then re-run for updates)
curl -X POST "https://<ref>.supabase.co/functions/v1/import-exercises" \
     -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```

No service_role key at hand? `npm run seed:exercises:sql` regenerates
`supabase/seed/exercises.sql` from `seed/exercises.json`; paste it into the
dashboard SQL editor instead. Same rows, same upsert, safe to re-run.

Staple foods (chicken breast, rice, varză…) are not in Open Food Facts, which
only knows packaged products. `npm run seed:foods:sql` writes
`supabase/seed/foods.sql` from the curated list in `apps/web/lib/demo-foods.ts`;
run it the same way, after `seed/accounts.sql` (the rows are owned by the admin).

## Test accounts

`npm run seed:accounts` creates one account per role on whatever project
`apps/web/.env.local` points at — `admin@`, `trainer@` and `client@healthapp.test`,
password `HealthApp!Dev2026` — and puts the trainer and the client in an active
relationship. Roles and the relationship are service-role writes (nobody can set
their own `role`), so the secret key has to be in the environment:

```bash
SUPABASE_SERVICE_ROLE_KEY=sb_secret_... node scripts/seed-accounts.mjs
```

Re-running resets the passwords instead of duplicating anything; override
`SEED_PASSWORD` / `SEED_DOMAIN` for different credentials. Tiers are left to
`handle_new_profile()`, which stamps the 30-day trial.

## Design notes (why it looks like this)

- **RLS is the security model.** Apps hit tables directly; every coach-access
  check funnels through `is_active_coach_of()`. Test policies with pgTAP in CI.
- **Offline idempotency**: `logged_sessions`, `logged_sets`, `food_logs`,
  `habit_logs` carry a unique `client_generated_id` — the mobile outbox can
  retry forever without duplicates. `received_at` is server-authoritative.
- **Macro snapshots**: `food_logs` stores computed kcal/macros at log time;
  external food data may change, history must not.
- **One active coach per client** is enforced by a partial unique index, not
  app code. Invites live on `trainer_clients` (`client_id` null until claimed);
  `accept_invite()` raises `INVALID_CODE` / `EXPIRED` / `ALREADY_HAS_COACH`.
- **Adherence engine v1** (`compute_adherence_snapshots()`) implements the spec
  formula (40/30/15/15) with the inactivity override, stores its `inputs` jsonb
  and a plain-language `reason` (explainable signals), and enqueues
  `client_at_risk` notifications — scheduled weekly via pg_cron when available.
- **Engine tables have no write policies** — snapshots, streaks, badge awards,
  notifications are service-role/cron only by construction.
- **Verification status**: the SQL and the edge functions in this folder have
  not been run against a live stack yet — `supabase start` needs Docker, which
  the current dev machine does not have. Treat `supabase db reset` +
  `npm run db:test` as the first thing to run once Docker is available.
- Not yet wired (per plan): streak *computation* job (Phase 5 — `detect_streak_risk`
  only warns, it does not compute `streaks`), the service-role purge worker that
  finishes `account_deletion_requests` after 30 days, and storage buckets +
  policies (Phase 0/4).
