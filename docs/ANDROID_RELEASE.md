# Releasing the native app (Phase 6)

Written 2026-10-24. What stands between the code on `main` and Voinic in Google Play (and later the
App Store). **Owner** = something only the owner can do (accounts, money, approvals);
**Claude** = can be done in a session once the owner's part exists.

## 0. Where things stand

| | State |
|---|---|
| Client screens (Today, Workout + offline + rest timer, Food + barcode, Habits, Progress, Check-in, Coach chat, Notifications) | built, tested in code, **never run on a device** |
| Coach screens (Clients, Inbox: check-ins + requests, Chats) | built, tested in code, **never run on a device** |
| Server for all of them (`/api/v1/*`) | live on www.voinic.fit |
| Push notifications | built, **not live** (migration, function, vault, EAS + FCM — apps/mobile/README.md → Push) |
| TWA bridge (`apps/android-twa`) | code ready; no Play account yet (ANDROID_PLAY_CHECKLIST.md) |

## 1. See it work on a phone

- [ ] **Owner** — iPhone: Expo Go, five minutes ([IPHONE_TEST.md](IPHONE_TEST.md)).
- [ ] **Owner** — Android phone (anyone's): an EAS preview build ([ANDROID_PHONE_TEST.md](ANDROID_PHONE_TEST.md)).
- [ ] **Owner** — try the checklist in those guides as a client **and** with a coach account; send
      screenshots of anything wrong.
- [ ] **Claude** — fix what that turns up.

## 2. Push, so messages arrive with the app closed

- [ ] **Owner** — approve applying migration `20261208100000_push_devices` to the live project.
- [ ] **Claude** (after the approval) — `npm run db:gate -- --remote`, apply, deploy `push-dispatch`.
- [ ] **Owner** — vault secrets, EAS project id, FCM key (apps/mobile/README.md → Push, steps 3–4).
- [ ] **Owner + Claude** — send a message from the coach account; the client's phone shows it.

## 3. Google Play

1. [ ] **Owner** — Play developer account (personal), identity verification ([ANDROID_PLAY_CHECKLIST.md](ANDROID_PLAY_CHECKLIST.md) §1).
2. [ ] **Owner** — App content forms: privacy policy, data safety, health apps, content rating, target
       audience 16+, account deletion URL `https://www.voinic.fit/delete-account` (same checklist §4).
       The native app adds one data type to the TWA's form: **camera** (barcode only, no photos stored).
3. [ ] **Owner** — store listing, RO + EN, screenshots from a test account (checklist §5).
4. [ ] **Claude** — production build: `npx -y eas-cli@24.12.1 build --profile production --platform android`
       (an `.aab`; `versionCode` from `app.json`, 1000+ so it replaces the TWA's 1, 2, …).
5. [ ] **Owner** — upload it to the **closed testing** track; 12+ testers for 14 days (checklist §6).
       If the TWA is already on the track, the native build simply becomes the next version —
       same package `fit.voinic.app`, same Play App Signing key.
6. [ ] **Owner + Claude** — run the Maestro flows on a tester's phone (`apps/mobile/.maestro`).
7. [ ] **Owner** — apply for production access; release with a staged rollout (20 % → 50 % → 100 %).

## 4. Before every later release

- [ ] `npm run typecheck`, `npm run lint`, `npm test` green; `npx expo export --platform android` builds.
- [ ] Bump `android.versionCode` (and `ios.buildNumber`) in `apps/mobile/app.json`.
- [ ] If the release needs a server change the old builds cannot handle, raise `min_build` in
      `apps/web/app/api/v1/app-config/route.ts` **after** the new build is in the store — older
      builds then show "Update" instead of breaking.
- [ ] `/api/v1` only grows: never rename or remove a field old builds read.
- [ ] Maestro flows on one real phone.

## 5. iPhone (App Store) — later

- [ ] **Owner** — Apple Developer Program (99 USD/year).
- [ ] **Claude** — an iOS profile in `eas.json`, build, TestFlight.
- [ ] **Owner** — Sign in with Apple switched on (docs/APPLE_SIGNIN_SETUP.md) before App Store review,
      if the app offers Google sign-in by then; App Store privacy forms.

## What the app still does not do (by choice, for v1)

Google / Apple sign-in inside the app (email only; the web has both), building programs or meal
plans (web), progress photos and charts, custom foods and recipes, social feed, challenges, coach
discovery (opens the web), in-app purchases (paywall is off). docs/ANDROID_PLAN.md §9 "Later".
