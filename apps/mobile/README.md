# Voinic for Android — the native app (Expo)

Phases 1+ of [docs/ANDROID_PLAN.md](../../docs/ANDROID_PLAN.md). It replaces the TWA
(`apps/android-twa`) later **as an update of the same package**, `fit.voinic.app` — hence
`android.versionCode` starts at **1000** in `app.json`, far above anything the TWA uses.

Expo SDK 58 (React Native 0.88, React 19.3.0), Expo Router, TanStack Query, supabase-js.

## What exists (2026-10-23)

| | |
|---|---|
| Sign-in | email + password against the same Supabase project (`lib/auth.tsx`); the session in SecureStore, chunked (`lib/chunked-store.ts`, tested) |
| Today | `GET /api/v1/today` — the web's own `getToday()`, so the same adherence %, streak, next workout, nutrition, habits, check-in |
| Workout | native (2026-10-23): the program list (`GET /api/v1/workouts`), a day (`GET /api/v1/workouts/[dayId]` — prescription, today's sets, last time per lift), the set logger and Finish (`POST /api/v1/sets`, `POST …/finish` — the web's own `logSet()` / `finishWorkout()`) |
| Offline | **every** set, food log, habit tick and check-in is saved on the phone first (`lib/outbox-core.ts`, tested; SQLite via `lib/storage.ts`) and sent by `lib/outbox.tsx` — on reconnect, on foreground, every 20 s. Replays are safe: `logSet` derives its keys from the set. The day and the list are kept on the phone (`lib/offline-query.ts`), so the logger opens with no signal once the day was opened online. Finish needs the outbox empty. |
| Rest timer | `packages/shared`'s rules, kept on the phone (`lib/rest.tsx`), started by `restAfterLoggedSet()` exactly as on the web; the end is a **local** notification (`expo-notifications`), so it fires offline and with the app closed. Channels `rest` (may show on the lock screen) / `rest-quiet`, chosen by `rest_prefs.alert`; no sound or vibration is ever requested. Permission is asked at the first rest. |
| Food | native (Phase 3): the diary by day (`GET /api/v1/food` — targets, totals, entries, the coach's planned meals), "ate as planned", remove an entry; add by search (`/foods/search`), recent / favourites, or **barcode** (`expo-camera`, ML Kit; `/foods/barcode/[code]`, a miss falls through to search), then the portion (`portionMacros` from `packages/shared`). Logs go through the outbox (`POST /food/logs`, the phone's id as `clientId`). |
| Habits | `app/habits.tsx`: tick / untick today, through the outbox as a state (`POST /habits/done` = `setHabitDone`) |
| Progress | weigh-in and waist (`POST /measurements`, online), recent measurements with the change, best lifts (`GET /api/v1/progress`); charts, photos, goals stay on the web |
| Coach thread | `app/messages.tsx`: the current coach's conversation (`GET /api/v1/coach-thread`), send (`POST /messages` = `sendMessage`, online only), read on open; new messages live through Supabase Realtime. Pictures and voice notes show as a line that opens the web. |
| Notifications | `app/notifications.tsx`: the web's center (`GET /api/v1/notifications`, headline in the reader's language), mark read, open what it is about; the card that turns push on |
| Push | `lib/push.tsx` / `lib/push-token.ts`: registers the Expo token (`POST /push-devices` → `register_push_device`) once permission exists, unregisters on sign-out; channels `messages`, `coaching`, `reminders`, `updates` (no sound or vibration requested); a tap routes by category (`lib/push-route.ts`, tested) |
| Check-in | `app/check-in.tsx`: weight, the five 1–10 scales, the coach's questions, a note — through the outbox (`POST /check-in`; "already checked in" counts as delivered); last week's feedback |
| More | who is signed in (`GET /api/v1/me`), language RO/EN, links (privacy, account deletion), sign out |
| Strings | `@healthapp/i18n` — `common` plus the app's own `mobile` namespace, `en` + `ro` |
| Colours | `@healthapp/ui-tokens`, the web's palette; follows the device's light/dark |

Not yet: Google sign-in (needs the Android OAuth client, plan §5), editing or deleting a logged
set, supersets shown as rounds (they log fine, listed per exercise), the live countdown *inside*
the notification (Android's chronometer needs a native module), a PR mark before the server's
answer, push, a custom food or a recipe of one's own, editing a food portion, progress photos, the coach screens —
the phases in the plan. Not yet run on a device.

## Push: what has to happen on the live project (not done)

Nothing below is applied; until it is, the app works and simply receives no server pushes
(the rest timer's local notification does not depend on any of it).

1. Apply migration `20261208100000_push_devices.sql` to the live project (the usual path:
   `npm run db:gate -- --remote <ledger>`, then push). It schedules `push-dispatch-tick`.
2. Deploy the function: `supabase functions deploy push-dispatch`.
3. Vault, once: `select vault.create_secret('https://<ref>.supabase.co/functions/v1/push-dispatch', 'push_dispatch_url');`
   and `select vault.create_secret('<service role key>', 'push_dispatch_key');` — until both exist the tick does nothing.
4. `eas init` in `apps/mobile` (writes `extra.eas.projectId` into the app config — the token needs it), and
   upload an **FCM v1 service-account key** for `fit.voinic.app` in EAS → Credentials (Firebase project → Cloud Messaging).
5. Check: sign in on a phone, allow notifications, send yourself a message from the coach account —
   the push lands in the "Messages" channel, a tap opens the thread.

Known gap: `notifications.title` is written by the database in one language; the push shows it as stored.

## How the app reaches the data

The app holds a Supabase access token and calls **`/api/v1/*` on the web app** with
`Authorization: Bearer …` and `x-voinic-locale`. There, `v1Route` (`apps/web/lib/api/v1.ts`)
runs the handler inside `withBearer` (`apps/web/lib/supabase/bearer.ts`), and while it does
`supabaseServer()`, `currentUserId()` and `getLocale()` answer from the token instead of
cookies. So a handler calls the **same** `lib/` reads the web pages call, as the token's
owner, under the same RLS — no second implementation. The response types are
`packages/api/src/v1.ts`; that contract only grows (old builds stay installed).

## Run it

One-time: `apps/mobile/.env` from `.env.example` (the anon key is public; never a service
key). Then, from the repo root:

```bash
npm install
```

```bash
npm run start --workspace=@healthapp/mobile
```

The app uses native modules (SecureStore, localization), so it runs in a **development
build**, not Expo Go: `npx expo run:android` (needs Android Studio's SDK + an emulator or a
USB phone with debugging on) or an EAS development build (`eas build --profile development`).

Check that the JS bundles for Android without a device:

```bash
npm run export:android --workspace=@healthapp/mobile
```

To point it at the local throwaway stack instead of production, set `EXPO_PUBLIC_SUPABASE_URL`
/ `EXPO_PUBLIC_SUPABASE_ANON_KEY` to the stack's (`scripts/pgtest/stack-env.mjs`) and
`EXPO_PUBLIC_API_URL` to the local app; an emulator reaches the host at `10.0.2.2`.

## Monorepo notes

- **Two Reacts on purpose.** React Native needs exactly react 19.3.0; the web is on 19.2.
  npm nests this app's React under `apps/mobile/node_modules`, and `metro.config.js` pins
  every `react` import to it — without that, a hoisted package would load the web's copy
  ("Invalid hook call").
- Shared packages ship TypeScript source; Metro compiles them like app code.
- `typecheck` runs in `npm run typecheck` (turbo) and CI; the pure `lib/**/*.test.ts` run
  in the root Vitest.
