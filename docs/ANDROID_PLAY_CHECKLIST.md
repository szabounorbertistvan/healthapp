# Google Play — the owner's checklist (Phase 0, TWA)

Everything in Phase 0 of [ANDROID_PLAN.md](ANDROID_PLAN.md) that code cannot do. Decided
2026-10-23: **TWA first, personal developer account**. The build itself is in
[apps/android-twa/README.md](../apps/android-twa/README.md).

Already done in code: the TWA definition (`fit.voinic.app` → `https://www.voinic.fit/today`),
`/.well-known/assetlinks.json` with a placeholder fingerprint (and middleware no longer
redirects it to `/login`), and the public deletion page **https://www.voinic.fit/delete-account**.

## 1. Developer account

- [ ] Create a **personal** account at https://play.google.com/console (USD 25, once), with
      the Google account that should own Voinic for years — preferably a dedicated one, with
      two-step verification on. Losing access to it means losing the app listing.
- [ ] Complete Google's identity verification (an ID document; Google may also ask you to
      confirm a real Android phone through the Play Console app). Days, sometimes weeks.
- [ ] Contact email shown on the listing: `contact@voinic.fit`. Personal accounts must also
      give a phone number to Google (not shown publicly).

## 2. The upload key (once, then keep it forever)

- [ ] Create `voinic-upload.keystore` with the `keytool` command in the TWA README.
- [ ] Store the keystore file and both passwords in your password manager, plus one offline
      copy (USB stick). **Never** in git, email or chat.

## 3. Create the app in Play Console

- [ ] Create app: name **Voinic**, default language **Romanian (ro-RO)**, App, Free.
- [ ] Turn on **Play App Signing** (the default) — Google keeps the signing key, you keep the
      upload key.
- [ ] Build the bundle (`bubblewrap update --skipVersionUpgrade`, `bubblewrap build`) and
      upload `app-release-bundle.aab` to the **Internal testing** track first.
- [ ] **App integrity → App signing**: copy the app-signing **SHA-256** and send it to the
      developer (or paste it yourself into `apps/web/public/.well-known/assetlinks.json` in
      place of `REPLACE_WITH_PLAY_APP_SIGNING_SHA256`). After it is deployed, the app opens
      without a browser bar — check on a phone.

## 4. App content forms (Policy and programs → App content)

- [ ] **Privacy policy**: `https://www.voinic.fit/privacy`
- [ ] **App access**: sign-in is required — give Google a reviewer account (a dedicated test
      client, *not* your own and not a real client's) with its email and password, entered
      only in Play Console.
- [ ] **Ads**: no ads.
- [ ] **Target audience**: 16–17 and 18+ only (the terms require 16+). Not for children, so
      the Families policy does not apply.
- [ ] **Content rating** (IARC questionnaire): category *Health & Fitness / Utility*; answer
      **yes** to "users can interact / exchange content" (messages, feed, comments), **no** to
      sharing the user's location, violence, gambling and purchases.
- [ ] **Health apps declaration**: fitness and nutrition tracking, coaching; **not** a medical
      device, no diagnosis or treatment. No Health Connect use.
- [ ] **Data safety** — what the app collects (all *required for app functionality*,
      encrypted in transit, deletable on request via `https://www.voinic.fit/delete-account`,
      **not sold, not shared** — Supabase and Cloudinary process it on our behalf, which Play
      does not count as sharing):
  - Personal info: name, email address, user IDs; approximate city if the person adds it.
  - Health and fitness: health info (weight, measurements, check-in answers), fitness info
    (workouts, sets, food logs, habits).
  - Photos: progress photos, avatar, post pictures (only if the person adds them).
  - Messages: in-app messages with the coach.
  - App activity: in-app interactions; **analytics only with consent** (Google Analytics runs
    only after "Accept analytics" on the cookie banner — declare it as *optional*).
  - App info and performance: crash/error logs (`record_app_error`).
- [ ] **Account deletion**: app has accounts → deletion inside the app (Account / Settings →
      Delete this account) **and** the web link `https://www.voinic.fit/delete-account`.
- [ ] **Government apps / financial features / news**: no.

## 5. Store listing (Grow users → Store presence → Main store listing)

- [ ] Short description (≤ 80 characters) and full description, **Romanian and English**.
- [ ] App icon 512 × 512 PNG (Bubblewrap writes `store_icon.png` next to the project).
- [ ] Feature graphic 1024 × 500.
- [ ] At least 2 phone screenshots (Today, set logger, food diary, coach dashboard) — from a
      **test account**, never a real person's data.
- [ ] Category **Health & Fitness**; contact email; website `https://www.voinic.fit`.

## 6. Closed test: 12 testers for 14 days (the personal-account rule)

Google lets a new personal account publish to production only after a **closed test with at
least 12 testers who stay opted in for 14 days in a row**, then a short questionnaire.

- [ ] Create a **Closed testing** track, promote the internal build to it.
- [ ] Testers: a Google Group (easiest — add/remove people without touching Play Console) or an
      email list. Recruit **15–20**, not 12: someone always drops out, and the count must stay
      ≥ 12 for the whole 14 days.
- [ ] Send them the opt-in link; each must accept *and install* the app. Ask them to use it
      for real (a workout, a food log, a message) — Google asks what feedback you got.
- [ ] Day 15+: **Apply for production access** in the dashboard; answer how testing went and
      what changed.
- [ ] After approval: release to **Production**, staged rollout (20 % → 100 %).

## 7. Keep in mind

- **Do not switch the paywall on** while the app is on Play without deciding the billing
  question first: a Play app must sell digital subscriptions through Play Billing (or the EEA
  alternative-billing programme). With the paywall off, `/billing` is not reachable.
- Every update needs a higher `appVersionCode`; site changes need **no** update — the app
  shows the live site.
- The native app will later ship as an update of this same app: keep the package name, the
  account and the upload key.
