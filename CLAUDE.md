# HealthApp — project guide

**Brand: Voinic** ("Coach. Plan. Progress."). `HealthApp` survives only as the repo
folder and the `@healthapp/*` package scope, which are infra ids. The user-facing
name comes from `APP_NAME` in `apps/web/lib/brand.ts`; the mark lives in
`components/logo.tsx` and `app/icon.svg`. Dark is the brand look (gold on
near-black). The theme **follows the device by default** (`prefers-color-scheme`
in `app/globals.css`); the `bg-theme` cookie (`lib/theme.ts`) holds an explicit
`dark` / `light` override, cycled by `components/theme-toggle.tsx`.

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

CI (`.github/workflows/ci.yml`) runs typecheck + test + build, a `deno check` over
`supabase/functions/` (the edge functions are Deno modules that `tsc` never sees —
run it locally with `npx -y deno@2 check --node-modules-dir=auto supabase/functions/`),
plus a separate job that applies every migration to a throwaway stack and runs the
RLS tests.

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
check-ins, messages, settings, admin. `(client)` = today, workout (list of every
published program → `workout/[dayId]` day overview + per-day history →
`workout/[dayId]/log` set logger), workout/build, food, habits, progress,
check-in, coach, billing. Ungrouped: landing `page.tsx`, login, complete-profile
(username / sex / age / coach-or-client for accounts that signed up without
them — both layouts redirect there while `users.username` is null), privacy,
terms, get-the-app. Profile editing (photo, city, bio, units, time zone) is the
shared `ProfileForm` in `components/account.tsx`, mounted on the client's
`/account` and the coach's `/settings`; the avatar is a public Cloudinary
upload (`lib/cloudinary.ts`), unlike progress photos.

**`(client)` is not client-only.** A coach trains too, so the coach sidebar and
the phone "More" sheet carry **My training** → `/today`, and `(client)/layout.tsx`
lets any role in; while there, `BackToCoaching` in `components/client-nav.tsx` is
the way back to `/dashboard`. Nothing is duplicated — every read under `(client)`
is scoped to the signed-in user (`lib/actor.ts`) and every policy on those tables
is owner-based, so a coach logging a set is the same code path as a client doing
it. What differs is copy: anything that says "your coach" needs a solo variant,
keyed off `ClientToday.has_coach` / `hasActiveCoach()` (`noProgramSolo`,
`atRiskBodySolo`, `noProgramHintSolo`).

## The five conventions that matter

**1. Supabase is the only backend. There is no demo mode.** It was removed on
2026-09-14: 168 `isDemo` branches across 37 files, four fixture modules, and the
`bg_view` view switcher all went. Development runs against the live project with
the seeded test accounts. A read or a write is now **one branch**:

```ts
const supabase = await supabaseServer();
```

Missing `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` is a deployment fault, not a
mode: `lib/supabase/server.ts` throws a named error when a client is first
constructed (lazily, so the env-less `npm run build` CI runs still succeeds) and
`middleware.ts` fails closed with a 500 rather than waving requests past the auth
gate. `builder-actions.ts` was driven end-to-end against the live project on
2026-09-14 (create → day → exercise → publish → client sees it).
`nutrition-actions.ts` still **has not been**; treat it as unverified until
someone has. Every `update`/`delete` in them goes through `lib/supabase/mutate.ts`
(`mutated()`): PostgREST answers an RLS-filtered write with success and zero
rows, and the guard turns that into an error. New coach writes must use it.

**2. Server components read, server actions write.** Reads live in
[lib/data.ts](apps/web/lib/data.ts) (coach surfaces) and
[lib/client-data.ts](apps/web/lib/client-data.ts) (client surfaces). Writes live
in `app/*-actions.ts`, all `"use server"`, all returning
`ActionResult = { ok, message?, errorCode? }`, all calling `revalidatePath` on the
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
- There is no coach/client view switcher — the **My training** link is not one.
  It opens the client surface *as the coach themselves*; `lib/view-mode.ts` and
  the `bg_view` cookie, which showed one person another person's screens, were
  demo-only on purpose (doing it live would be admin impersonation of health
  data) and went with demo mode. To see a real client's data, use a client test
  account.
- Barcode scanning uses `@zxing/browser` in [components/barcode-scanner.tsx](apps/web/components/barcode-scanner.tsx);
  a miss must always fall through to search, never dead-end.
- Who is signed in is shown by `displayName()` in `lib/data.ts` — the username,
  never the email (`users.full_name` falls back to the email in the sign-up
  trigger). Sign-up asks for full name, username, sex and age; they travel as
  user metadata into `handle_new_user` (migration `20260910100000`).
- `logged_sets.rpe` is the felt intensity 1..10 from the slider; `rir` is what
  the client typed in an RIR program; `notes` is the per-set comment. In a
  program, `program_exercises.target_rpe` holds whatever the coach typed under
  the program's own scale (RIR for RIR programs) — the builder writes it raw.
- Never run `npm run build` (or anything else writing `apps/web/.next`) while
  the dev server is up: the production build clobbers the dev server's `.next`
  and every route then serves a bare "Internal Server Error" with
  `ENOENT ... _buildManifest.js.tmp.<hash>` in the log. Stop the preview,
  `rm -rf apps/web/.next`, restart.
- **One dev server per working tree.** Several sessions share this tree, and
  `preview_start` with `web` while port 3000 is already taken (`autoPort`)
  spawns a second Turbopack over the same `apps/web/.next`: both then thrash
  each other and every page crawls. If `http://localhost:3000` already
  answers, attach with the `web-attached` launch entry instead. Before killing
  a stray `next dev`, check whose it is (`Get-CimInstance Win32_Process`).
- `SUPABASE_TRACE=1` in `.env.local` logs every Supabase round trip with its
  duration to the dev server output — the first thing to reach for when a page
  is slow. Each PostgREST call from this box costs ~120–160 ms and an RPC
  ~300 ms, so a page's cost is its number of *sequential* waves, not queries.
- Date helpers (`isoDay`, `daysAgoIso`, `mondayOf`, `daysSince`) live in
  `lib/dates.ts`; serving sizes and the `FoodItem` / `FoodPortion` shapes live in
  `lib/food-portions.ts`. Both were carved out of the deleted demo modules.
- The rest timer between sets is timestamp-based (`startedAt` / `endsAt` in
  `packages/shared/src/rest-timer.ts`, persisted in `localStorage`), mounted
  once in `(client)/layout.tsx`. Its "rest finished" push is a separate,
  best-effort path (`public/sw.js`, `rest_pushes`, edge function `rest-push`)
  that needs one-time VAPID setup — see docs/ENGINES.md. Never sound, never
  `navigator.vibrate`.

## Deeper notes

- [docs/ENGINES.md](docs/ENGINES.md) — per-feature map: what each engine does, which files, what state it's in.
- [docs/GAPS.md](docs/GAPS.md) — what the spec promises that the code does not do yet.
- [docs/DISHFINDER.md](docs/DISHFINDER.md) — the sibling project at `D:\react\dishfinder` and the
  ingredient deep-link idea. **Researched, not built** — no code here references it.
