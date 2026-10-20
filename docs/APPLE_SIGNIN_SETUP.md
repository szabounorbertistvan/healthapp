# Sign in with Apple: switching it on

The button is in the code (`components/login-form.tsx`, 2026-12-07) and appears
by itself once the Apple provider is enabled in Supabase — the login form reads
the project's enabled providers (`enabledOAuthProviders()`), as it does for Google.
The callback is the same `/auth/callback`; an Apple account without a username
goes through `/complete-profile`, like a Google one.

App Store rule: an iOS app that offers Google sign-in must offer Apple too, so
this is needed before the native app is submitted. On the web it is optional.

## Steps (needs an Apple Developer account, 99 USD/year)

1. https://developer.apple.com/account → Certificates, Identifiers & Profiles.
2. **Identifiers → App IDs**: an App ID (e.g. `fit.voinic.app`) with
   "Sign In with Apple" ticked.
3. **Identifiers → Services IDs**: a Services ID (e.g. `fit.voinic.web`), tick
   "Sign In with Apple" → Configure: primary App ID = the one above; domain
   `caiaretlxiljiiuoirtp.supabase.co`; return URL
   `https://caiaretlxiljiiuoirtp.supabase.co/auth/v1/callback`.
4. **Keys**: a key with "Sign In with Apple", download the `.p8` (once only).
   Note the Key ID and your Team ID.
5. Supabase → Authentication → Sign In / Providers → **Apple** → enable.
   Client IDs: the Services ID (and later the iOS bundle id, comma-separated).
   Secret key: Supabase generates it from Team ID, Key ID and the `.p8` content
   (paste them in the form). The secret expires after 6 months — set a reminder
   to regenerate it.
6. Open `/login`: "Continue with Apple" is shown above Google.
