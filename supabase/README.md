# BuddyGym — Database & Backend

Supabase (Postgres) schema implementing [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) §4 and the
permission matrix from [PRODUCT_SPEC.md](../PRODUCT_SPEC.md) §4.

## Layout

```
supabase/
├── migrations/
│   ├── 20260823000100_types.sql        # extensions, enums, shared triggers
│   ├── 20260823000200_core.sql         # users, trainer_clients (invites), goals, RLS helpers
│   ├── 20260823000300_training.sql     # exercises, programs, logged sessions/sets, videos, events
│   ├── 20260823000400_nutrition.sql    # foods cache, nutrition plans, food logs (macro snapshots)
│   ├── 20260823000500_progress.sql     # measurements, check-ins, photos, adherence snapshots
│   ├── 20260823000600_coaching.sql     # conversations, messages, polymorphic coach feedback
│   ├── 20260823000700_engagement.sql   # habits, streaks, badges (+MVP catalog), notifications
│   ├── 20260823000800_rls.sql          # every RLS policy — mirrors the permission matrix 1:1
│   └── 20260823000900_functions.sql    # invites, coach_dashboard, adherence engine v1, GDPR export, pg_cron
└── functions/
    ├── food-search/       # local cache → Open Food Facts search; caches hits into `foods`
    ├── barcode-lookup/    # cache → OFF product API; 404 = "not found, offer search/custom"
    └── import-exercises/  # one-shot import of Free Exercise DB (873 exercises, public domain)
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
- Not yet wired (per plan): `push-dispatch` worker (Phase 4), `sync-ingest`
  batch endpoint (Phase 1, S5), streak computation job (Phase 5), storage
  buckets + policies (Phase 0/4).
