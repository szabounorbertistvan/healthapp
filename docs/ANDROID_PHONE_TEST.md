# Testing the Android app on your phone

Written 2026-10-24. The app (`apps/mobile`) has never run on a device yet; this is how to put
it on yours. The build happens in Expo's cloud (**EAS Build**), so this Windows computer needs
no Java or Android SDK. You run the commands below yourself, because they sign in to **your**
Expo account.

There are two kinds of build. Start with **A**.

| | A. Preview (recommended first) | B. Development |
|---|---|---|
| What you get | a normal app file (APK) with everything inside | an app that loads its code from this computer |
| Needs this computer running | no | yes (`npm run start`), phone on the same Wi-Fi |
| Good for | trying the app like a user would | changing code and seeing it on the phone at once |
| Command | `build:preview` | `build:dev` |

Both talk to the **live** Voinic (www.voinic.fit and the live database). Sign in with a test
account or your own — what you log is real.

## One-time setup (about 10 minutes)

1. Create a free account at https://expo.dev (sign-up in the browser).
2. In a terminal, from the repository root (after `npm install`, the EAS tool is part of the project):

   ```bash
   cd apps/mobile && npx eas login
   ```

3. Still in `apps/mobile`, link the app to your Expo account (creates the project and writes its id into
   `apps/mobile/app.json` — commit that change, or tell Claude to):

   ```bash
   npx eas init
   ```

4. Give the cloud build the three public settings the app needs. The values are the same as the
   web's `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Vercel → Settings →
   Environment Variables, or `apps/web/.env.local`). The anon key is public by design — it ships
   in every browser that opens the website — but never put the **service role** key here.

   ```bash
   npx eas env:create --environment preview --environment development --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR-REF.supabase.co --visibility plaintext
   ```

   ```bash
   npx eas env:create --environment preview --environment development --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value YOUR-ANON-KEY --visibility plaintext
   ```

   ```bash
   npx eas env:create --environment preview --environment development --name EXPO_PUBLIC_API_URL --value https://www.voinic.fit --visibility plaintext
   ```

5. Set an Android signing key when the first build asks: answer **Yes, generate a new keystore**.
   Expo keeps it in your account (back it up later from expo.dev → Credentials). It becomes the
   upload key for Google Play too, so do not delete it.

## A. Preview build

```bash
npm run build:preview --workspace=@healthapp/mobile
```

It takes about 10–20 minutes in the cloud (the free plan can queue). At the end the terminal and
expo.dev show a link and a QR code.

On the phone:

1. Open the link (or scan the QR code) and download the APK.
2. Android asks to allow installing apps from this source (Chrome / Files) — allow it once.
3. Install, open **Voinic**, sign in.

A new build installs over the old one; your data is on the server, so nothing is lost.

## B. Development build

```bash
npm run build:dev --workspace=@healthapp/mobile
```

Install it the same way. Then, each time you want to use it:

1. Make sure `apps/mobile/.env` exists (copy `.env.example`, fill the three values as in step 4).
2. Start the code server on this computer:

   ```bash
   npm run start --workspace=@healthapp/mobile
   ```

3. Phone and computer on the same Wi-Fi; open the Voinic dev app, it lists this computer — tap it
   (or scan the QR code the terminal shows). If Windows Firewall asks, allow Node.js on private
   networks.

## What to try (and tell Claude what happened)

- [ ] Sign in; Today shows the same percentage and next workout as the website.
- [ ] Workout: open a day **with signal** once. Then turn on **airplane mode**, open the logger,
      log two sets — they show with a clock mark. Turn airplane mode off: the marks disappear
      within ~20 s and the sets are on the website.
- [ ] Rest timer: after a set, lock the phone. The "Rest finished" notification should arrive at
      the right second (allow notifications when asked). Note how late it is, if it is.
- [ ] Food: search, add with a portion; scan a product's barcode; "Ate as planned" if your
      coach planned a meal.
- [ ] Habits: tick one in airplane mode, back online it stays ticked on the website.
- [ ] Progress: a weigh-in; the weekly check-in.
- [ ] Coach: send a message; reply from the coach account on the website — it appears without
      refreshing.
- [ ] Language RO/EN (More), dark/light (follows the phone).
- [ ] Anything that looks wrong: a screenshot is the most useful thing to send.

Server push notifications (a message from your coach while the app is closed) will **not**
arrive yet: that needs the steps in [apps/mobile/README.md](../apps/mobile/README.md) → "Push".

## If something goes wrong

- **The build fails in the cloud:** open the build on expo.dev, copy the red part of the log,
  send it to Claude.
- **"App not installed":** an app with the same name from another source is on the phone
  (later, the Play Store version). Uninstall it first.
- **Sign-in says no connection:** the three settings in step 4 are missing or mistyped — check
  them on expo.dev → the project → Environment variables, then build again.
