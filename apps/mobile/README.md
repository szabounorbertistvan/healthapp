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
| Workout · Food · Progress | placeholders that open the same screen on voinic.fit (`components/on-web.tsx`) |
| More | who is signed in (`GET /api/v1/me`), language RO/EN, links (privacy, account deletion), sign out |
| Strings | `@healthapp/i18n` — `common` plus the app's own `mobile` namespace, `en` + `ro` |
| Colours | `@healthapp/ui-tokens`, the web's palette; follows the device's light/dark |

Not yet: Google sign-in (needs the Android OAuth client, plan §5), offline sets, rest timer,
push, scanner, every other screen — the phases in the plan.

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
