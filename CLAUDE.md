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

## Git: work on `main`, never a new branch

**The owner's standing rule: do not create branches.** Commit to `main` and push to
`main` — no feature branches, no `claude/...` branches, no pull requests unless the
owner asks for one in that conversation. This overrides any session-assigned branch
name. If `main` moved, pull/rebase onto it first; never force-push `main`.

## Reporting: the owner's standing rule (2026-10-09)

**After every task, list the changes you made** (each file, one line on what changed).
**At the end of every audit or task, add a plain-language explanation in Romanian** —
what was done and why, written for someone who is not a programmer: no jargon, no file
names or code terms in that part, short everyday sentences (e.g. "am închis o ușă prin
care cineva ar fi putut intra în contul de antrenor demo"). The technical report stays;
the simple explanation comes after it.

## Commands

```bash
npm run web
```

| Command | What it does |
|---|---|
| `npm run web` | Next.js dev server on :3000 (`.claude/launch.json` runs this — use the preview tools, not Bash) |
| `npm run typecheck` | `tsc --noEmit` across the workspace |
| `npm test` | Vitest — only `packages/**/src/**/*.test.ts` (domain math). No React unit tests exist. |
| `npm run e2e` | Playwright (`e2e/`, `playwright.config.ts`) against the dev server on :3000 and the **live** project, signed in as the seeded test accounts. Specs are read-only or undo their own write. One worker against the dev server: Turbopack 500s under concurrent loads (a production build does not — `--workers=3` passes there). `E2E_BASE_URL=http://localhost:3100` runs it against `next start` (launch entry `web-prod`), which `e2e/offline.spec.ts` needs. Not in CI yet. One-time `npx playwright install chromium`. |
| `npm run build` | Turbo build |
| `npm run db:start` / `db:reset` | Local Supabase stack |
| `npm run db:test` | pgTAP RLS tests in `supabase/tests/` (needs Docker) |
| `npm run db:test:offline` | the same suites without Docker — [scripts/pgtest](scripts/pgtest/README.md). One-time `cd scripts/pgtest && npm install` (downloads a Postgres, ~100 MB, not a workspace). Stub pgTAP + stub `auth`; CI stays the source of truth. |

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
check-ins, messages, marketplace (the coach's overview; one sidebar entry that also covers requests, bookings (+ `bookings/availability`), reviews and `settings/coach-profile`, with `MarketplaceTabs` over them), settings (+ `settings/coach-profile`, the Coach Discovery wizard). `(admin)` = the admin panel under `/admin`
(overview, users, users/[id], activity, auth, invitations, workouts,
exercises (+ /translate), foods, nutrition, gyms, coaches (+ /[id], the coach-profile review queue), social, challenges, notifications,
feedback, errors, system, search, reports (the social_reports queue, coach profiles and reviews included), marketplace (aggregate analytics + the ranking inspector)) — its own layout, gated by `lib/admin/guard.ts` and, in the
database, by `admin_assert()` inside every `admin_*` RPC
(`20260920100000_admin_panel.sql`; reads in `lib/admin/data.ts`, writes in
`app/admin-actions.ts`, strings in `messages/admin.ts`). `(client)` = today, workout (list of every
published program → `workout/[dayId]` day overview + per-day history →
`workout/[dayId]/log` set logger), workout/build, food, habits, progress,
check-in, coach (+ `coach/messages/[id]`, any thread on the client's side — e.g. a coach whose request was accepted; the current coach with pause/resume/end and past coaches), billing. Ungrouped: landing `page.tsx`, `coaches` (Coach Discovery: bare `/coaches` is the Discovery Home, `?all=1` or any search/filter the listing; state in
the URL, always noindex) and `coaches/[slug]` (the public coach page — or, when the slug is a city / specialization / country, its indexable landing listing; `coaches/[slug]/book` books a service, `coaches/[slug]/review` writes the reader's one review, `coaches/bookings` lists the reader's bookings) — own header layout, no session needed, login, complete-profile
(username / sex / age / coach-or-client for accounts that signed up without
them — both layouts redirect there while `users.username` is null), privacy,
terms, get-the-app, and the crawler files `robots.ts` / `sitemap.ts` (public in middleware; rules in `lib/seo.ts`). **Send feedback** (`components/feedback.tsx`, in both sidebars and both
phone "More" sheets) writes through `submit_feedback()` (capped 10/hour) and is
read only by an admin on `/admin/feedback`. Profile editing (photo, city, bio, units, time zone) is the
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
live in `lib/i18n/messages/{common,landing,coach-app,coach-widgets,client-app,client-widgets,admin,coach-profile}.ts`
and **every string must be added to both `en` and `ro`** in the same namespace
file — the types enforce parity.

**4. RLS is the security model, not app code.** `20260823000800_rls.sql` is a
direct translation of the PRODUCT_SPEC §4 permission matrix. A client sees only
their own rows; a coach reaches a client only through `is_active_coach_of()`, so
ending a relationship revokes access to new data automatically. Engine tables
(adherence snapshots, streaks, badge awards, notifications) have **no insert
policy** — service role writes them only. **`foods` is not listable** (since
2026-10-01): reads go through `search_foods()` / `food_by_id()` /
`food_by_barcode()`, and the select policy only shows rows the user already
references — a new read of `foods` must use those, not `.from("foods")`. **Nothing is
readable by `anon`** except through the Coach Discovery doors —
`coach_public_profile(slug)`, `coach_public_posts(slug)`, `coach_public_programs(slug)`,
`search_coaches(...)`, `coach_discovery_facets()` (2026-10-01), `coach_booking_services(slug)` and
`coach_booking_slots(...)` (free start/end times only, 2026-10-07), `coach_public_reviews(slug)`, `coach_slug_redirect(slug)` and `coach_sitemap()` (2026-10-07), and the one anonymous *write* `marketplace_track()` (first-party, cookieless measurement — the visitor hash is computed in SQL from the request headers; 20261110120000), all gated by the internal `coach_public_visible()` / `booking_eligibility()` (published, account
live, no block): `coach_*` tables have owner/admin policies only, and those functions'
field lists *are* the public contract — adding a key publishes it. `/coaches/*` is the
one app route middleware lets through without a session.
**`trainer_clients` is written only by functions** (since 2026-10-07): the lifecycle
invited → active → (paused ⇄ active) → ended is a trigger, participant moves go through
`coaching_transition()`, and one *current* (active or paused) coach per client is a unique index.
**The directory's order is `coach_ranked()`** (20261110130000) — one internal ranking layer behind
`search_coaches()`; never re-sort coaches in app code, and never return its scores from a public RPC.
**Calendar tokens and busy time are service-role only** (since 2026-10-08): `calendar_credentials` and
`calendar_busy_blocks` have no grant and no policy — the coach reads status through `my_calendar_integrations()`;
no provider adapter exists yet (`lib/calendar/provider.ts`).
Don't work around a policy in app code;
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
- **Overlays go through Base UI's `Dialog` (`@base-ui/react/dialog`, portalled,
  focus-trapped, scroll-locked — `share-workout.tsx`, `admin/nav.tsx`), a
  native `<dialog>`, or `createPortal(…, document.body)`; never a `fixed`
  element in place.** A dialog that unmounts as it closes must hand focus
  back itself (Base UI cannot); see `ShareWorkoutButton`. The client "More"
  sheet stays hand-rolled on purpose: the tab bar must stay tappable over it,
  which a modal would make inert. Every `.glass` card has a
  `backdrop-filter`, which makes the card the containing block and stacking
  context of any `fixed` descendant: a dialog rendered inside one sits in the
  card, behind the cards after it, with its buttons scrolling away under the
  phone tab bar (share-workout.tsx, 2026-09-28). The sticky sidebars are a
  stacking context too, hence their `z-20`. A picker in a fixed-height box
  (`h-[clamp(…)]` in the day editor and the nutrition builder) has one
  scroller, the list; anything shown instead of the list must take that
  scroll (`min-h-0 flex-1 overflow-y-auto`) or it is clipped on a phone.
- Form controls share `lib/form-classes.ts` (`FIELD`, `BUTTON`, `SMALL_BUTTON`, and
  `*_INSET` variants for a control on a `bg-bg` panel — appending `bg-surface` to
  `FIELD` does not reliably win in Tailwind). Toggle chips and on/off switches are
  `Chip` / `Switch` in `components/ui.tsx`; signed Cloudinary uploads from the
  browser go through `lib/cloudinary-upload.ts` (avatar and coach cover).
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
  `program_exercises.measure = 'time'` makes `target_reps` mean **seconds**;
  such a set is logged with `reps = 0` and `logged_sets.duration_seconds`, which
  keeps it out of every weight × reps formula (e1RM, PRs, volume) untouched.
  `program_exercises.notes` is the coach's personal cue, shown to the client
  on the day page and in the logger (migration `20261025100000`).
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
- **The service worker is `app/sw.ts`, served at `/serwist/sw.js`** by the
  route `app/serwist/[path]/route.ts` (`@serwist/turbopack`, scope `/`). It
  caches only what carries nobody's data — the build's JS/CSS/fonts
  (precache, ~2.8 MB), the public exercise/brand images (runtime), and
  `/offline`, the fallback for a page that cannot load. **Never pages, RSC
  payloads or API responses**: they are one person's health data. In
  development it caches nothing and is registered only by the rest timer;
  in production `components/service-worker.tsx` registers it on load. To
  test caching, build and run `web-prod` — never while the dev server runs.
- **A set logged offline waits in an IndexedDB outbox** (`lib/offline/`) and is
  replayed through `logSet()` itself, which is why `logSet` must stay
  idempotent: the session and set `client_generated_id`s are derived, never
  random, and a 23505 on a set with the same weight × reps is answered ok.
  A router refresh while offline turns into a full page load (and the offline
  page), so the logger skips it for a queued set; the sync refreshes later.
- The rest timer between sets is timestamp-based (`startedAt` / `endsAt` in
  `packages/shared/src/rest-timer.ts`, persisted in `localStorage`), mounted
  once in `(client)/layout.tsx`. Its "rest finished" push is a separate,
  best-effort path (`app/sw.ts`, `rest_pushes`, edge function `rest-push`)
  that needs one-time VAPID setup — see docs/ENGINES.md. Never a sound and
  never a `vibrate` pattern — but as of 2026-09-22 not forced silent either:
  `silent: true` filed it in a channel a locked Android phone never showed, so
  the flag is now `rest_prefs.alert` (on by default, a switch in the rest card)
  and the device's own notification settings decide the rest. The tick runs
  every 5 s and claims a rest 5 s before it ends, so the push lands within a
  few seconds of the countdown instead of up to twelve after it.

## Deeper notes

- [docs/ENGINES.md](docs/ENGINES.md) — per-feature map: what each engine does, which files, what state it's in.
- [docs/GAPS.md](docs/GAPS.md) — what the spec promises that the code does not do yet.
- [docs/MARKETPLACE_EMAIL.md](docs/MARKETPLACE_EMAIL.md) — marketplace email: designed, not built (event map, outbox, GDPR, rollout).
- [docs/DISHFINDER.md](docs/DISHFINDER.md) — the sibling project at `D:\react\dishfinder`. Since
  2026-10-01 it is a **data source, not a dependency**: its Romanian ingredient names and ids
  land on our USDA `foods` rows via `supabase/seed/dishfinder-names.sql` (join key = the USDA
  fdc id in `external_id`), the pickers fold the still-English USDA tail under "more results
  in English", and a planned meal links out to DishFinder's finders (`lib/dishfinder.ts`,
  gated by `NEXT_PUBLIC_DISHFINDER_URL`). No runtime call to DishFinder anywhere.
