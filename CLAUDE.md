# HealthApp — project guide

Fitness & coaching platform replacing "WhatsApp + Excel + a tracker app". Two
roles: **coach** (builds programs and nutrition plans, watches adherence) and
**client** (logs workouts and food, checks in). Romanian + English from day one.

The long-form product/architecture docs are `PRODUCT_SPEC.md` and
`DEVELOPMENT_PLAN.md` at the root — they describe the *intended* full product.
This file and `docs/` describe **what actually exists in the code**, which is a
subset. When the two disagree, the code wins; see [docs/GAPS.md](docs/GAPS.md).

## Commands

```bash
npm run web
```

| Command | What it does |
|---|---|
| `npm run web` | Next.js dev server on :3000 (`.claude/launch.json` runs this — use the preview tools, not Bash) |
| `npm run typecheck` | `tsc --noEmit` across the workspace |
| `npm test` | Vitest — only `packages/**/src/**/*.test.ts` (domain math). No React tests exist. |
| `npm run build` | Turbo build |
| `npm run db:start` / `db:reset` | Local Supabase stack |
| `npm run db:test` | pgTAP RLS tests in `supabase/tests/` |

CI (`.github/workflows/ci.yml`) runs typecheck + test + build, plus a separate
job that applies every migration to a throwaway stack and runs the RLS tests.

## Layout

```
apps/web/            Next.js 15 App Router, React 19, Tailwind v4 — the ONLY app
packages/shared/     domain math: macros, adherence, PRs, entitlements, billing, sync
packages/api/        error shapes shared with edge functions
packages/ui-tokens/  design tokens
supabase/migrations/ schema + RLS — source of truth
supabase/functions/  Deno edge functions
```

**There is no `apps/mobile`.** The plan calls for an Expo app; nothing has been
written. Every "client app" screen today is a web route under
`apps/web/app/(client)/`.

Route groups: `(coach)` = dashboard, clients, programs, nutrition, library,
check-ins, messages, settings, admin. `(client)` = today, workout, food, habits,
progress, check-in, coach, billing. Ungrouped: landing `page.tsx`, login,
privacy, terms, get-the-app.

## The five conventions that matter

**1. Demo mode.** `isDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL`
([lib/supabase/server.ts](apps/web/lib/supabase/server.ts)). With no Supabase URL
set, the whole app runs off in-memory fixtures (`lib/demo.ts`,
`lib/demo-store.ts`, `lib/demo-foods.ts`, `lib/demo-client-store.ts`). Every
server action and every data function is written as **two branches**:

```ts
if (isDemo) { ...mutate the store, revalidatePath, return { ok: true, demo: true } }
const supabase = await supabaseServer();  // live branch
```

If you add a read or a write, you must write both branches or you break the demo.
Note the honesty markers in the code: the Supabase branches of
`builder-actions.ts` and `nutrition-actions.ts` **have never run against a live
database**. Treat them as unverified.

**2. Server components read, server actions write.** Reads live in
[lib/data.ts](apps/web/lib/data.ts) (coach surfaces) and
[lib/client-data.ts](apps/web/lib/client-data.ts) (client surfaces). Writes live
in `app/*-actions.ts`, all `"use server"`, all returning
`ActionResult = { ok, message?, demo? }`, all calling `revalidatePath` on the
routes they touch. Client components call the action then `router.refresh()`.

**3. i18n is cookie-based, not routed.** No `/en/` or `/ro/` prefixes — locale
lives in the `bg-locale` cookie ([lib/i18n/config.ts](apps/web/lib/i18n/config.ts)).
Server components use `await getI18n()`, client components `useI18n()`. Strings
live in `lib/i18n/messages/{common,landing,coach-app,coach-widgets,client-app,client-widgets}.ts`
and **every string must be added to both `en` and `ro`** in the same namespace
file — the types enforce parity.

**4. RLS is the security model, not app code.** `20260823000800_rls.sql` is a
direct translation of the PRODUCT_SPEC §4 permission matrix. A client sees only
their own rows; a coach reaches a client only through `is_active_coach_of()`, so
ending a relationship revokes access to new data automatically. Engine tables
(adherence snapshots, streaks, badge awards, notifications) have **no insert
policy** — service role writes them only. Don't work around a policy in app code;
change the policy and add a pgTAP test.

**5. Domain math lives in `packages/shared` and is mirrored in SQL.** Macros,
adherence, PRs, entitlements. Duplicating a formula in a component is the bug
this package exists to prevent — the coach dashboard and client app must never
disagree on a number.

## Data model in one breath

`users` (role + tier) → `trainer_clients` (one active coach per client) →
training (`programs` → `program_days` → `program_exercises`, logged as
`logged_sessions` → `logged_sets`) → nutrition (`foods`, `nutrition_plans` →
`planned_meals` → `planned_meal_foods`, logged as `food_logs`) → progress
(`measurements`, `check_ins`, `progress_photos`, `adherence_snapshots`) →
coaching (`conversations`, `messages`, `coach_feedback`) → engagement (`habits`,
`streaks`, `badges`) → billing (`subscriptions`, Stripe).

Two deliberate denormalizations: **`food_logs` snapshots macros at log time**
(external food data changes; history must not), and `foods.portions` is a jsonb
serving list guarded by a check constraint because an edge function parsing
third-party text writes it.

## Gotchas

- Windows dev box; the shell is PowerShell. Paths in this repo use `/`.
- Tailwind v4 — config is in CSS (`app/globals.css`), not `tailwind.config.js`.
  Semantic color names only, defined in an `@theme` block with a
  `prefers-color-scheme: dark` override: `bg`, `surface`, `ink`, `ink-soft`,
  `ink-faint`, `line`, `accent`, `accent-ink`, `accent-soft`, `warn`,
  `warn-soft`, `risk`, `risk-soft`. Never hardcode a hex.
- `lib/view-mode.ts` lets a demo admin switch between coach and client surfaces
  via the `bg_view` cookie. It is **demo-only on purpose** — doing it live would
  be admin impersonation of health data.
- Barcode scanning uses `@zxing/browser` in [components/barcode-scanner.tsx](apps/web/components/barcode-scanner.tsx);
  a miss must always fall through to search, never dead-end.

## Deeper notes

- [docs/ENGINES.md](docs/ENGINES.md) — per-feature map: what each engine does, which files, what state it's in.
- [docs/GAPS.md](docs/GAPS.md) — what the spec promises that the code does not do yet.
- [docs/DISHFINDER.md](docs/DISHFINDER.md) — the sibling project at `D:\react\dishfinder` and the
  ingredient deep-link idea. **Researched, not built** — no code here references it.
