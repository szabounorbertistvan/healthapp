# Android app — plan

Written 2026-10-22. **A plan, not a description of code:** nothing below exists yet
except where it says "exists". The intended product is in `pdf/PRODUCT_SPEC.pdf` and
`pdf/DEVELOPMENT_PLAN.pdf` (§2 stack, §5 offline, §8 phases); what the code does today is
in [CLAUDE.md](../CLAUDE.md), [GAPS.md](GAPS.md) and [ENGINES.md](ENGINES.md).

## 0. Where we start

What the Android app can stand on, as of today:

| Piece | State | What it means for Android |
|---|---|---|
| `apps/web` (Next.js) | the whole product: 40 client pages, 23 coach pages, admin | every screen exists once, as a server-rendered web page |
| `app/*-actions.ts` | ~8,300 lines of server actions — **every write** | a native app **cannot call a server action** (no stable URL, cookie-bound). This is the biggest backend change in the plan, see §4 |
| `lib/data.ts`, `lib/client-data.ts`, `lib/client-today.ts` | every read, server-side, through the cookie session | reusable from an API route once the Supabase client is passed in |
| `packages/shared` | domain math (macros, adherence, PRs, rest timer, streaks, …), pure TS, no DOM/Next imports | reused as-is by a React Native app |
| `packages/ui-tokens` | written for the Expo app — **but stale**: still the old green palette, while the brand in `app/globals.css` is gold on near-black | must be brought back in line before the app uses it |
| i18n | `apps/web/lib/i18n/messages/*.ts`, plain objects, ~12k lines, `en` + `ro` with type-enforced parity | movable into a package; `fill()` works anywhere |
| `packages/api` | error shapes + generated `database.types.ts` | reused as-is |
| Supabase + RLS | the security model; every client table is owner-scoped | the app talks to the same project; nothing about RLS changes |
| `supabase/functions/sync-ingest` | built for a mobile outbox, **never used**; predates `rir`, `duration_seconds` and the web's derived session keys | **do not use as-is** — see §6 |
| `supabase/functions/push-dispatch` | Expo Push fan-out with quiet hours and the engagement cap, **never used**: nobody writes `users.push_token`, no cron calls it, and its auth compares the bearer to `SUPABASE_SERVICE_ROLE_KEY` (the pattern that broke `rest-push` once a project has `sb_secret_` keys) | reused after three fixes, see §7 |
| Web offline outbox (`lib/offline/`) + idempotent `logSet()` | live since 2026-10-01 | the native outbox replays through the **same** `logSet` logic |
| Rest-timer Web Push (`rest-push`) | live, web only | not needed natively: a local notification does it offline, see §7 |
| Google sign-in | live (web OAuth) | native flow needs an Android OAuth client, see §5 |
| Apple sign-in | button in code, provider not switched on (`docs/APPLE_SIGNIN_SETUP.md`) | not required on Google Play; required later for iOS |
| `app/manifest.ts` + service worker | live | makes the web app installable — the basis of the TWA in Phase 0 |
| Paywall / Stripe | built, **switched off**, Stripe not live | lets v1 of the Android app sell nothing (§9 Payments) |

## 1. Technology choice

Three realistic options.

| | **A. TWA** (Trusted Web Activity, Bubblewrap) | **B. Capacitor** (WebView over the live site) | **C. Expo / React Native** (the spec's choice) |
|---|---|---|---|
| What it is | the existing site, opened full-screen by Chrome, packaged as an APK | the existing site in a WebView, plus native plugins | a real native app; the web stays for coaches' builders and the public directory |
| Time to Play Store | **1–2 weeks** | 3–5 weeks | **5–6 months** to the full client + coach-light app (1 developer) |
| Reuse of today's code | 100 % — it *is* the web app | ~100 % of the screens | shared math, i18n, tokens, DB, RLS, API cores; **UI rewritten** |
| Offline | as the web: only an open set logger survives; nothing *opens* offline | same | **real**: today's program, history and the logger open in a basement gym; food and habit logs can queue too |
| Rest timer when locked | Web Push via the server (works, needs signal) | FCM via a plugin (needs signal) | **local notification**, exact to the second, no signal needed, live countdown in the notification shade |
| Push | Web Push (already built) | FCM plugin + new backend path | Expo Push → FCM; `push-dispatch` already written for it |
| Barcode / camera | browser camera (`@zxing/browser`, works in Chrome) | native plugins | native ML Kit scanner via `expo-camera`, faster in poor light |
| Google sign-in | works (it is Chrome, cookies and all) | **blocked** — Google refuses OAuth inside a WebView; needs a custom browser hand-off | native Google sign-in (`signInWithIdToken`) |
| Play policy risk | low (TWA is Google's own wrapper; needs Digital Asset Links) | **medium** — "website in a WebView" apps are rejected under Minimum Functionality unless they add real native value | none specific |
| iOS later | no (no TWA on iOS) | possible, App Store guideline 4.2 risk | same codebase builds for iOS |
| Feels like | a web page (pull-to-refresh, web scrolling, layout jumps) | same | a native app |

**Recommendation: C (Expo), with A as a two-week bridge.**

1. **Phase 0 — ship the TWA under the final package name `fit.voinic.app`.** It costs two
   weeks, puts Voinic on Google Play now, and — more importantly — starts the clock on
   Google's rules for new developer accounts (a personal account needs a closed test with
   ≥ 12 testers for 14 days before it may publish to production). That gate would otherwise
   sit in the critical path of the native launch.
2. **Phases 1–6 — build the Expo app in `apps/mobile`.** It replaces the TWA **as an update of
   the same package**: same `fit.voinic.app`, a higher `versionCode`, the same Play App Signing
   key. Users get the native app through a normal store update; they sign in once more
   (the TWA's session lives in Chrome's cookies).

Why not stop at the TWA: the spec's non-negotiable is *offline workout logging* (§1 of the
development plan), and the TWA cannot open a single screen without signal — a basement gym
is the normal case, not the edge case. A locked-phone rest timer that works without signal,
a native scanner and native-feeling lists are the rest of the gap. Why not Capacitor: it
carries the TWA's offline limits *and* breaks Google sign-in *and* carries the WebView policy
risk, to buy plugins Expo gives natively.

What C costs: every screen is written a second time, in React Native. The plan keeps that
bounded by building **the client app first**, the coach's "on the go" view second, and
**leaving the builders, admin and the public directory on the web** (the spec says the same:
coach mobile is "read/respond only in MVP").

## 2. Shape of the codebase

```
apps/web/            unchanged role; gains app/api/v1/* (§4)
apps/mobile/         NEW — Expo SDK (current at kickoff), Expo Router, TypeScript
packages/shared/     reused as-is (domain math)
packages/api/        reused as-is (error shapes, database types)
packages/ui-tokens/  fixed to the gold palette, then consumed by both (§3)
packages/i18n/       NEW — the message files moved out of apps/web/lib/i18n/messages (§3)
packages/core/       optional later — see §4 on where the action cores live
```

- npm workspaces already cover `apps/*` and `packages/*`; Expo's Metro resolves a monorepo
  without custom config since SDK 52. **React must be one version across the workspace**
  (web is React 19; pick the Expo SDK whose React matches, and pin it in the root
  `overrides` if npm hoists two copies — two Reacts is the classic monorepo crash).
- Libraries (all Expo-compatible, chosen to match the spec's §2): Expo Router (file
  routes, deep links for free), TanStack Query (reads + persisted cache), `expo-sqlite`
  (outbox and offline snapshots), `react-native-mmkv` (small fast state: rest timer, prefs,
  query cache), `@supabase/supabase-js` (auth + realtime), `expo-notifications` (push +
  scheduled local notifications), `expo-camera` (barcode), `expo-image-picker` +
  `expo-image-manipulator` (photos, compressed ≤ 2 MB), `@react-native-google-signin/google-signin`,
  `expo-web-browser` + `expo-auth-session` (Apple / email links), `@sentry/react-native`,
  `react-native-svg` + a light chart library for the progress charts.
- Styling: NativeWind (Tailwind classes in React Native) is tempting because the web is
  Tailwind, but the web classes do not transfer anyway (no `backdrop-filter`, no CSS grid).
  **Recommended: plain `StyleSheet` + a small `theme` built from `@healthapp/ui-tokens`**,
  fewer moving parts on Windows builds. Revisit only if screen-writing speed suffers.

## 3. What is reused, and how

**Domain math — `packages/shared`.** Imported directly. The same `isPersonalRecord`,
`estimated1RM`, `validateSetEdit`, `mealsForWeekday`, adherence, streaks and the rest-timer
state machine (`rest-timer.ts`) the web uses. Rule from CLAUDE.md convention 5 stands: a
formula in a mobile component is a bug. The server stays authoritative (e.g. a PR flagged
offline is provisional until the API answers).

**Strings — `packages/i18n`.** Move `apps/web/lib/i18n/messages/*.ts` plus `fill()` and the
`Locale` type into a package; `apps/web/lib/i18n/index.ts` re-exports from it, so no web
import changes. Mobile-only strings go into a new `mobile` namespace, `en` + `ro`, with the
same type-enforced parity. The device locale picks the default; the choice is stored on the
device and sent to the API as `x-voinic-locale` so server-side messages come back in the
person's language. Only the namespaces the app needs are bundled (`common`, `clientApp`,
`clientWidgets`, `coachApp`, `coachWidgets`, `onboarding`, `mobile`) — `admin` and `landing`
stay out.

**Design tokens — `packages/ui-tokens`.** Step one is fixing it: replace the green values with
the gold/near-black palette from `app/globals.css` (both themes, plus the tokens the web has
gained since: `accent-fg`, `tile-*`), then add a Vitest that parses `globals.css` and fails if
the two disagree. The app follows the device theme by default with a dark/light override, as
the web does (`lib/theme.ts`). Fonts: bundle the web's font files with `expo-font`. The logo
comes from `app/icon.svg` via `react-native-svg`.

**Backend — the same Supabase project, the same RLS.** The app signs in with the same
accounts; every query runs under the person's own JWT, so the RLS matrix (owner-only rows,
`is_active_coach_of()`, `foods` only through `search_foods()` / `food_by_barcode()`) applies
unchanged. The anon key is the only key the app ever holds. No new policy is needed for reads.

## 4. The API layer (the main backend change)

Writes live in server actions, which a native app cannot call. Two ways out:

1. *Call PostgREST directly from the app and re-implement each action.* Rejected: it
   duplicates validation, PR detection, the derived idempotency keys and the error copy —
   the exact disagreement `packages/shared` exists to prevent.
2. **Extract each action's body into a "core" function that takes an authenticated Supabase
   client, and expose it twice**: the existing server action (cookie session) and a new route
   handler under `apps/web/app/api/v1/` (bearer token). One implementation, two doors.

```ts
// lib/core/sets.ts — no "use server", no cookies, no revalidatePath
export async function logSetCore(ctx: { supabase, userId, t }, input: LogSetInput): Promise<LogSetResult>

// app/client-actions-training.ts — unchanged signature for the web
export async function logSet(input) { … return logSetCore(await actionContext(), input) + revalidatePath(…) }

// app/api/v1/sets/route.ts — the app's door
export async function POST(req) { const ctx = await bearerContext(req); … return Response.json(await logSetCore(ctx, body)) }
```

- `bearerContext(req)`: reads `Authorization: Bearer <access token>`, builds a Supabase
  client with that header (so RLS sees the person), verifies it with `auth.getUser()`, takes
  the locale from `x-voinic-locale`. Fails closed with 401.
- `middleware.ts` lets `/api/v1/*` through its cookie gate (the way it already lets
  `/api/cron/calendar-sync` through) — the handler authenticates itself.
- Reads get the same treatment where a screen needs several queries: `GET /api/v1/today`
  returns what `lib/client-today.ts` builds for `/today`, in one round trip (each PostgREST
  call from Romania costs ~120–160 ms; one aggregated call beats five from a phone). Simple
  single-table reads and RPCs (`search_foods`, the exercise library) may go straight through
  supabase-js.
- Versioned (`/api/v1`) because old app builds stay installed for months. A new field is
  additive; a breaking change is `/api/v2`. `app_flags` gains `android_min_build` so a build
  that can no longer work is told to update instead of failing silently.
- Extraction is done **per screen, as the app needs it**, not as a big-bang refactor. The web
  e2e and soak suites guard that each extracted action still behaves the same.
- Effort: ~1–2 days per action family (training, food, habits, body, check-in, messages,
  profile, rest, onboarding, notifications) — ~3 weeks spread across Phases 1–4.

## 5. Auth

| Method | Android flow | Backend/config needed |
|---|---|---|
| Email + password | `supabase.auth.signInWithPassword` / `signUp` with the same metadata (`full_name`, `username`, `sex`, `age`, role) that `handle_new_user` reads | none |
| Email confirm / password reset links | deep link `voinic://auth/callback` (and the App Link `https://www.voinic.fit/auth/...` once assetlinks is live) → `exchangeCodeForSession` | add the redirect URLs in Supabase → Auth → URL configuration **in the dashboard**. **Never `supabase config push`** (it overwrites production auth config). |
| Google | **built 2026-10-27 as the browser flow** (same as Apple below, `apps/mobile/lib/oauth.ts`): needs only the redirect URL. Later, optionally: native Google Sign-In → ID token → `signInWithIdToken({ provider: 'google', token })` | a Google Cloud **Android OAuth client** per signing key (SHA-1 of the EAS/upload key *and* the Play App Signing key), and that client id added to Supabase's Google provider "authorized client IDs" |
| Apple | optional on Android: `signInWithOAuth('apple')` in `expo-web-browser` with PKCE back to `voinic://auth/callback` | the provider switched on per `APPLE_SIGNIN_SETUP.md`; mandatory only for a future iOS build |

- Session storage: the Supabase session in encrypted storage (`expo-secure-store` holds an AES
  key; the session itself in MMKV encrypted with it — SecureStore alone caps values at 2 KB).
  Auto-refresh while the app is foregrounded.
- Accounts without a username (Google sign-ups) go through the same "complete profile" step as
  `/complete-profile` on the web; onboarding reads/writes `onboarding_state` through
  `onboarding_mark()` as on the web.
- Sign-out wipes the outbox *only after it is flushed* (or after an explicit "discard N unsynced
  sets" confirmation), the query cache, the SQLite snapshots and the push token registration.

## 6. Offline set logging

The spec's Tier 1 (§5), built on what the web already proved:

- **Snapshot.** When online, the app stores in SQLite: the published programs with their days
  and exercises, each exercise's last sessions (for "previous workout" and the PR baseline),
  and today's state. The workout list, the day page and the logger **open with no signal**.
- **Outbox.** A set is written to SQLite first (shown at once, with the web's "not synced"
  clock), then sent to `POST /api/v1/sets` — i.e. through `logSetCore`, the same logic as the
  web's `logSet`. Its idempotency is already server-side: session and set keys are derived
  from user, program day, date and set index, and a replay of a set already on record answers
  ok. The device sends the set's own `loggedAt`, so a set logged at 23:50 and synced after
  midnight stays in that evening's session (the rule `logSet` already enforces).
- **Replay** on regained connectivity (`@react-native-community/netinfo`), on app foreground
  and every 20 s while items wait; in order; per signed-in user. "Finish workout" waits for
  the outbox, as on the web. `chunkBatch` / `itemsToRetry` from `packages/shared/src/sync.ts`
  are reused if a batch endpoint is added.
- **Why not `sync-ingest`:** it keys sessions on device-generated ids, while the web derives
  them from (user, day, date). A person logging on the phone and on the web the same day
  would get two sessions; it also drops `rir`, `duration_seconds`, `notes`. Replaying through
  the one `logSet` core keeps a single rule. Decision for the owner: delete `sync-ingest`
  once the app ships, or rewrite it as a thin batch wrapper over the same core.
- **Later (Phase 3):** food logs and habit ticks through the same outbox (habit ticks are
  naturally idempotent per habit + day; food logs need a derived `client_generated_id`, which
  the column already supports). Edits and check-ins stay online-only in v1.
- PR badges computed offline from the snapshot with `isPersonalRecord` are marked provisional
  until the server's answer arrives.

## 7. Notifications and push

**Rest timer — local, no server.** The shared `rest-timer.ts` state machine (timestamps
`startedAt` / `endsAt`) persisted in MMKV. When a rest starts the app schedules a local
notification at `endsAt` and shows an ongoing notification with a live countdown
(Android's chronometer — via Notifee, or a ~50-line Expo module if Notifee is not maintained by
then). Pause/+15 s/skip reschedule or cancel. Works offline and with the app killed. Honour the
web's rules: no sound or vibration forced by the app, `rest_prefs.alert` decides whether it
alerts, the OS settings decide the rest. Delivery precision: an inexact alarm can slip by a
minute in Doze; test on real phones in Phase 2 before deciding whether the exact-alarm
permission is worth its Play policy cost (`USE_EXACT_ALARM` is reserved for alarm apps;
`SCHEDULE_EXACT_ALARM` needs the user's grant on Android 14+).

**Server push — reuse `push-dispatch`, after three fixes** (Phase 4):

1. **Device tokens table.** `users.push_token` holds one token per person; a person has a phone
   and maybe a tablet, and tokens rotate. New migration: `push_devices (user_id, token unique,
   platform, app_build, created_at, last_seen_at)`, owner select/delete, writes only through
   `register_push_device(token, platform, build)` / `unregister_push_device(token)` (security
   definer, `authenticated` only — added to `function_privilege_hygiene.test.sql`), pgTAP for
   isolation. `users.push_token` is dropped afterwards.
2. **Auth.** Replace the bearer-vs-`SUPABASE_SERVICE_ROLE_KEY` string compare with the pattern
   `rest-push` uses (the caller's bearer as the client key, a service-only RPC decides).
3. **Scheduling and receipts.** A pg_cron job (`push-dispatch-tick`, like `rest-push-tick`),
   and handling Expo's tickets/receipts: `DeviceNotRegistered` deletes that device row.

Then: Android notification channels per category (messages, coaching, reminders, social), so
the person can mute one in system settings; `notification_prefs` stays the in-app switch and
`push-dispatch` already honours it, plus quiet hours and the two-a-day engagement cap. Every
push carries a deep link (`voinic://coach/messages/<id>` etc.), which Expo Router resolves.
Check before switching on: the language of `notifications.title/body` — they must be rendered
in the recipient's locale, not the sender's.

Credentials: an FCM v1 service-account key uploaded to EAS (Expo Push needs it to reach FCM).
Android 13+ asks for notification permission at runtime — ask in context (first rest timer,
first message), never on first launch.

## 8. Barcode scanner and camera

- **Barcode:** `expo-camera`'s built-in scanner (ML Kit; EAN-13/EAN-8/UPC-A/UPC-E). On a hit →
  `food_by_barcode()` → else the `barcode-lookup` edge function → else **search with the code
  prefilled** (the web's rule: a miss never dead-ends). Torch toggle for gyms with bad light.
- **Photos:** `expo-image-picker` (camera or gallery) → `expo-image-manipulator` (≤ 2 MB,
  strip EXIF location) → the same signed Cloudinary upload the web uses
  (`lib/cloudinary-upload.ts`'s signing exposed as `POST /api/v1/uploads/sign`). Progress
  photos keep their private delivery; never written to the shared gallery unless the person
  saves one.
- Permissions: `CAMERA` asked when the scanner first opens; no storage permission needed with
  the system photo picker.

## 9. Screens and phases

Estimates are for **one full-time developer** working with Claude, including tests. (The
spec's 6–7 months assumed two developers building the backend too; the backend now exists.)

### Phase 0 — TWA bridge and Play account · 1–2 weeks
*Decided 2026-10-23: TWA first, personal account. Code side done — `apps/android-twa/`,
`assetlinks.json`, `/delete-account`; the owner's steps are
[ANDROID_PLAY_CHECKLIST.md](ANDROID_PLAY_CHECKLIST.md).*
- Google Play developer account (USD 25 once). **Decision for the owner:** personal account
  (the 12-testers / 14-days closed test applies) or organization account (needs a D-U-N-S
  number; no tester gate).
- Bubblewrap TWA of `https://www.voinic.fit/today`, package `fit.voinic.app`, Play App Signing.
- `public/.well-known/assetlinks.json` with the app signing key's SHA-256 **and a middleware
  exception for `/.well-known/`** — today a signed-out request there is redirected to `/login`,
  which would break the Digital Asset Links check and show the browser bar.
- Store listing (RO + EN), privacy policy (`/privacy` exists), Data safety form, Health apps
  declaration, content rating, account-deletion URL (Play requires a web page explaining
  deletion; `/account` has the delete card — add a public explainer page).
- Closed testing track with real coaches/clients → production when the gate allows.
- **Exit:** Voinic installable from Google Play.

### Phase 1 — Native foundations · 3–4 weeks
*Started 2026-10-23 — done: `apps/mobile` (SDK 58, Expo Router), `packages/i18n`, `packages/ui-tokens`
fixed + parity test, `/api/v1/me` + `/api/v1/today` with the bearer seam (`lib/supabase/bearer.ts`),
email sign-in, the five tabs (Today native, More native, three opening the web). Still open in this
phase: Google sign-in, Sentry, EAS project + build profiles, `android_min_build`, a first build on a phone.
See [apps/mobile/README.md](../apps/mobile/README.md).*
- `apps/mobile` (Expo Router, TypeScript strict, ESLint), wired into turbo `typecheck`/`lint`.
- `packages/i18n` extraction; `packages/ui-tokens` fixed + parity test; theme provider.
- Auth (§5): email, Google, password reset, complete-profile, sign-out wipe.
- API layer skeleton (§4): `bearerContext`, middleware exception, `/api/v1/me`, `/api/v1/today`.
- *(2026-10-24: `eas.json` with the three profiles, `expo-dev-client`, the phone guide
  [ANDROID_PHONE_TEST.md](ANDROID_PHONE_TEST.md); the EAS project itself waits for the owner's `eas init`.)*
- Sentry, `android_min_build` check, EAS project, `development` / `preview` / `production`
  build profiles, internal testing track.
- Shell: bottom tabs **Today · Workout · Food · Progress · More** (spec C-screens), More holds
  habits, check-in, coach, account, "Open on web" links for everything not built natively.
- **Exit:** sign in on a real phone from the internal track, Today shows real data in RO and EN.

### Phase 2 — Client training MVP (offline) · 5–6 weeks
*Started 2026-10-23 — done: workout list, day, set logger with the phone-first outbox (every set),
offline day copies, Finish, rest timer with local notifications; `/api/v1/workouts`, `/workouts/[dayId]`,
`/sets`, `/workouts/[dayId]/finish` over the web's own reads and actions. Open: edit/delete a set,
supersets as rounds, the in-notification countdown, provisional offline PRs, build-your-own (solo),
and the exit test on a real phone in airplane mode.*
- Workout list (every published program), day overview with per-day history, the set logger
  (weight × reps / time, RPE slider or RIR as the program says, per-set notes, coach cue,
  supersets), previous workout, PR moments, finish workout.
- Offline snapshot + outbox (§6); rest timer with local notifications (§7).
- Build-your-own workout (solo) can wait for Phase 3 if time is short.
- **Exit:** the spec's slice-1 exit — coach builds a program on the web, client trains it in
  airplane mode, sets sync, coach sees them.

### Phase 3 — Food, habits, progress, check-in · 5–6 weeks
*Started 2026-10-23 — done: food diary by day, search, barcode scanner, recent/favourites, portions,
"ate as planned", habits, weigh-in + waist, best lifts, weekly check-in with the coach's questions; food
logs, habit ticks and check-ins join the outbox (each replay-safe on the web side). Open: custom foods,
editing a portion, copy a meal, progress charts and photos, recipes; the exit test on a phone.*
- Food diary for a day, search (`search_foods`, the "more results in English" fold), barcode
  (§8), portions (`lib/food-portions.ts` logic moved to `packages/shared`), recents/favourites,
  "ate as planned" from the coach's plan (`mealsForWeekday`), My recipes logging.
- Habits with weekly dots and streaks; food logs and habit ticks join the outbox.
- Progress: weight trend, measurements, PR list; weekly check-in (weight, circumferences,
  sliders, note, photos via camera).
- **Exit:** a client logs a full day in under two minutes; numbers match the web.

### Phase 4 — Messages and push · 3 weeks
*Built 2026-10-24 — the coach thread (Realtime, text; pictures and voice notes open on the web), the
notifications center, `push_devices` + register/unregister + `claim_push_batch` (migration 20261208100000,
pgTAP), `push-dispatch` rewritten (Postgres decides who may call; devices table; dead tokens forgotten;
12-hour cut-off so no backlog is ever pushed), per-category Android channels, taps open the right screen.
**Not live:** the migration, the function deploy, EAS + FCM — see apps/mobile/README.md. Open: notification
text in the recipient's language (rows carry the writer-side title today), attachments in the app.*
- Coach thread (Supabase Realtime, as `message-thread.tsx`), unread badges, notifications list.
- `push_devices` migration + `push-dispatch` fixes + cron (§7); deep links; per-category
  channels; notification settings screen.
- **Exit:** the spec's slice-4 exit — client checks in → push to coach → coach replies → push
  to client.

### Phase 5 — Coach on the go · 3–4 weeks
*Built 2026-10-24 — coach tabs Clients (priority list, signal, the web's "why"), Inbox (check-in review with
feedback; requests accept/decline), Chats (every thread, shared ThreadView), My training; client detail and
bookings open the web. Endpoints `/api/v1/coach/*`, `/threads/[id]`.*
- Same app, coach mode (role from `users`); the coach can also use **My training** exactly as
  on the web (`(client)` is not client-only).
- Priority-sorted client list (On Track / Needs Attention / At Risk with the "why"), client
  quick view (adherence, last sessions, last check-in), check-in review + feedback, messages,
  accept/decline coaching requests and bookings.
- Program and nutrition **builders, library, marketplace settings, admin stay on the web**,
  opened in the browser from the app.
- **Exit:** a coach clears their check-in queue from the phone.

### Phase 6 — Hardening and release · 2–3 weeks
*Code side 2026-10-24 — version gate (`/api/v1/app-config`), crash screen, edit a logged set, Maestro flows
(`apps/mobile/.maestro`), the adherence % fix (shares 0..1 were shown unscaled), release checklist
[ANDROID_RELEASE.md](ANDROID_RELEASE.md). The rest is device testing and the stores — owner steps.*
- Maestro flows for the mandatory journeys (sign-in, log offline → sync, kill mid-sync,
  duplicate flush, food by barcode, check-in, message + push); accessibility (44 pt targets,
  TalkBack labels, font scaling); dark/light QA; low-end device pass (2–3 GB RAM phones);
  crash-free rate in Sentry.
- Replace the TWA: production release of the native build as an update of `fit.voinic.app`,
  staged rollout 10 % → 50 % → 100 %.
- **Exit:** native app in production; TWA retired.

**Total: ~5 months** to a native client app + coach-on-the-go on Google Play (Phase 0 runs
first and overlaps Phase 1's start).

### Later (not in this plan's estimate)
Social feed, challenges, leaderboards, achievements pages, routines library, reports, gyms,
Coach Discovery (stays a web page, opened in the browser), bookings for clients, Health
Connect (steps, weight import), in-app purchases, iOS (same codebase; needs Apple sign-in,
an Apple Developer account and App Store review), a home-screen widget for today's workout.

## 10. Build, signing, testing, publishing

**Build.** EAS Build in the cloud (no Android toolchain needed on the Windows box for
release builds). For daily work: Expo Go is not enough once native modules are in, so a
**development build** on an emulator (Android Studio on Windows) or a USB phone. Local
`npx expo run:android` needs JDK 17 + the Android SDK — optional.

**Signing.** Play App Signing on. The upload key is generated and held by EAS credentials;
export a backup into the owner's password manager. Record both SHA-1/SHA-256 fingerprints
(upload + app signing): they go into the Google OAuth Android client (§5) and `assetlinks.json`.
Losing the upload key is recoverable through Play support; losing control of the Play account
is not — two-factor on it.

**Versioning.** `versionCode` auto-incremented by EAS; `version` follows releases. JS-only fixes
may ship as EAS Update (over-the-air) **to the same runtime version only**, never to change
permissions or native modules; anything sensitive goes through a store release.

**Testing.**
- `npm test` keeps covering `packages/shared` (now also `packages/i18n` parity and the
  token parity test).
- `apps/mobile`: `jest-expo` + React Native Testing Library for components and the outbox
  (with SQLite mocked); added to CI next to the web tests.
- API routes: Vitest over the cores (they are plain functions now) + the existing web e2e and
  soak suites, which exercise the same cores through the web.
- Device E2E: **Maestro** flows against the **local throwaway stack** that `npm run e2e:local`
  already starts (`scripts/pgtest/stack.mjs`, seeded `.test` accounts); the emulator reaches
  the host at `10.0.2.2`. Never against the live project with writes — same rule as today.
- Manual: real phones before every release (one mid-range Samsung, one low-end, one Pixel)
  via the internal track.

**CI.** Add `apps/mobile` typecheck + lint + jest to `.github/workflows/ci.yml`. EAS builds are
triggered by hand (or on a tag) at first; build minutes on the free EAS tier are limited, so
not on every push.

**Publishing.** Tracks: internal (the developer + owner) → closed (beta coaches and clients)
→ production with staged rollout. Each release: release notes RO + EN, Data safety re-checked
when a new permission or data type appears, target API level kept at what Play requires
(Expo SDK upgrades carry it; plan one SDK upgrade a year).

**Payments.** Selling Voinic Premium (a digital subscription) inside a Play-distributed app
requires Google Play Billing, or Play's alternative-billing programme in the EEA (Romania
qualifies). The paywall is off today, so **v1 sells nothing in the app**: plan state is read
through `my_plan` and shown; no buy button, no link to a web checkout. Decide when the paywall
is switched on — RevenueCat (the spec's choice) is the shortest route to Play Billing next to
the web's Stripe, with one `subscriptions` table as the entitlement truth. Payment for
in-person coaching sessions is a physical service and outside that rule.

## 11. Backend changes — the complete list

| # | Change | Phase | Needs a migration? |
|---|---|---|---|
| 1 | `/.well-known/assetlinks.json` + middleware exception | 0 | no |
| 2 | Public account-deletion explainer page (Play requirement) | 0 | no |
| 3 | `packages/ui-tokens` brought in line with `globals.css` + parity test | 1 | no |
| 4 | `packages/i18n` extracted from `apps/web/lib/i18n/messages` | 1 | no |
| 5 | `lib/core/*` extraction + `app/api/v1/*` route handlers + `bearerContext` + middleware exception for `/api/v1/` | 1–5 | no |
| 6 | `app_flags.android_min_build` | 1 | small (a row / key) |
| 7 | Supabase Auth: redirect URLs for `voinic://` and the App Link; Google authorized client ids — **dashboard only, never `config push`** | 1 | no (config) |
| 8 | `push_devices` + `register_/unregister_push_device` RPCs + pgTAP + privilege-hygiene entry; drop `users.push_token` later | 4 | yes |
| 9 | `push-dispatch`: auth pattern, `push_devices`, receipts, cron `push-dispatch-tick`; check notification text locale | 4 | yes (cron) |
| 10 | `sync-ingest`: delete or rewrite over the `logSet` core | 6 | no |
| 11 | FCM v1 key in EAS (not Supabase) | 4 | no |

Nothing changes in RLS. Every migration follows the usual path: local + pgTAP
(`npm run db:test:offline`), `npm run db:gate`, applied live before the code that needs it
is pushed.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Two UIs drift (web and app show different numbers) | all math in `packages/shared`; all writes through the same cores; aggregated reads reuse `lib/client-*.ts` |
| Old app builds calling a changed API | `/api/v1` is additive only; `android_min_build` forces an update |
| Server-action extraction breaks the web | done per action family, guarded by the web e2e + soak suites |
| Offline sets lost on sign-out or reinstall | outbox flushed (or discard confirmed) before sign-out; a pending-count badge always visible |
| Rest-timer alert late on some phones (Doze, OEM battery savers) | ongoing countdown notification always shows the truth; measured on real devices in Phase 2 |
| Play review: health data, account deletion, closed-test gate | Phase 0 clears all three early |
| One developer, long project | phases are each shippable to the closed track; the TWA keeps Voinic on Play throughout |

## 13. Decisions the owner has to make

1. TWA bridge in Phase 0 — yes (recommended) or straight to native.
2. Play account type: personal (14-day tester gate) or organization (D-U-N-S).
3. `sync-ingest`: delete after launch (recommended) or keep as a batch wrapper.
4. When the paywall is switched on: Play Billing via RevenueCat, or EEA alternative billing.
5. iOS: after Android launch, or not planned. *(2026-10-24: the owner tests on an iPhone — Expo Go first,
   [IPHONE_TEST.md](IPHONE_TEST.md); a TestFlight build needs an Apple Developer account.)*
