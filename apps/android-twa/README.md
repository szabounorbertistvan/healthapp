# Voinic for Android — the TWA bridge

Phase 0 of [docs/ANDROID_PLAN.md](../../docs/ANDROID_PLAN.md): the live site
`https://www.voinic.fit/today`, opened full-screen by Chrome as a Trusted Web Activity
and packaged as `fit.voinic.app`. The native Expo app replaces it later **as an update of
the same package**, so the package id, the Play App Signing key and the upload key here are
permanent — never change `packageId`.

What the owner does by hand (Play account, forms, testers) is in
[docs/ANDROID_PLAY_CHECKLIST.md](../../docs/ANDROID_PLAY_CHECKLIST.md).

## What is in git

Only `twa-manifest.json` (the source of truth) and this README. The Android project
(Gradle files, `app/`, icons) is generated from the manifest by Bubblewrap and ignored; so
are the keystore and the built `.apk` / `.aab`. Not a workspace (no `package.json`), so
`npm install`, typecheck and CI never see it.

## One-time setup (Windows, PowerShell)

```bash
npm install -g @bubblewrap/cli
```

```bash
bubblewrap doctor
```

On first run Bubblewrap offers to download its own JDK 17 and Android SDK — accept.

**The upload key** — created once, by the owner, and backed up (password manager + one
offline copy). Lose it and Play support has to reset it; leak it and anyone can sign
updates for review. It never goes into git:

```bash
keytool -genkeypair -v -keystore voinic-upload.keystore -alias voinic-upload -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` is in the JDK Bubblewrap installed (`%USERPROFILE%\.bubblewrap\jdk\…\bin`).

## Build

From this folder:

```bash
bubblewrap update --skipVersionUpgrade
```

```bash
bubblewrap build
```

`update` (re)generates the Android project from `twa-manifest.json`; `build` asks for the
keystore passwords and writes `app-release-bundle.aab` (upload this to Play) and
`app-release-signed.apk` (for installing on a phone directly with `adb install`).

**Each new upload needs a higher `appVersionCode`.** Either edit it in `twa-manifest.json`
and commit, or run `bubblewrap update` without `--skipVersionUpgrade` (it bumps both
version fields) and commit the manifest.

## Linking the app to the site (Digital Asset Links)

Without it the app opens with a browser address bar on top. Chrome checks
`https://www.voinic.fit/.well-known/assetlinks.json` (in git at
`apps/web/public/.well-known/assetlinks.json`; middleware skips `/.well-known/` so a
signed-out request is not sent to `/login`).

1. After the first upload, Play Console → the app → **Test and release → App integrity →
   App signing**: copy the **SHA-256 certificate fingerprint of the app signing key**.
2. Replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256` in `assetlinks.json` with it.
3. To test a sideloaded APK before Play signs anything, add the upload key's SHA-256 as a
   second entry in the same list:

   ```bash
   keytool -list -v -keystore voinic-upload.keystore -alias voinic-upload
   ```

4. Commit, push, wait for Vercel, then check:
   `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://www.voinic.fit&relation=delegate_permission/common.handle_all_urls`

A fingerprint is public information (it identifies a certificate, it signs nothing), so it
is fine in git; the keystore and its passwords are not.

## Notes

- Sign-in, Google sign-in, the barcode scanner, the rest-timer notifications and the offline
  set logger all work as they do in Chrome — it *is* Chrome. Notifications go through the
  app (`enableNotifications`), so Android 13+ asks for the permission on the app's behalf.
- Nothing opens without signal, exactly as on the web (only an already-open set logger keeps
  working). That is the reason the native app follows.
- The app sells nothing: the paywall is off. Before switching it on, read the Payments
  paragraph of the plan (§10) — a Play app must use Play Billing for digital subscriptions.
