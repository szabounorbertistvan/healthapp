# Why pages and actions were slow in the soak — and what changed (2026-10-23)

The first overnight soak (`npm run e2e:soak`, 27 rounds on 2026-10-22, archived in
`e2e-local/.soak/archive-2026-10-22/`) showed server actions of 4–10 s, a burst of
sidebar prefetches at 3–7 s each, the lifecycle journey failing 21 rounds in 29, and
rounds getting slower over the night (12 → 22 min). This note is what that turned out to be.

How it was measured: `SUPABASE_TRACE=1 npm run e2e:soak -- --serve` (stack + production
build on :3211), a Playwright probe that signs in and records every document / RSC /
prefetch / server-action request with the `[supabase]` lines the render produced, and the
lifecycle journey run with `--trace on`, with timings read from its `trace.zip`.

## 1. The cause: the local stack signed HS256, production signs ES256

`lib/supabase/claims.ts` asks `getClaims()` first. It verifies the token locally *only* for
an asymmetric key; for an HS256 token it falls back to `GET /auth/v1/user`, a round trip to
GoTrue. The live project publishes one ES256 key (`/auth/v1/.well-known/jwks.json`), so in
production that never happens. The local stack (`scripts/pgtest/stack.mjs`) signed sessions
with its HS256 secret, so **every middleware pass and every render** called GoTrue, and this
GoTrue answers `/user` in a flat **~740 ms** (it holds no pooled DB connection; `/health`
answers in 1 ms, PostgREST in 4 ms). Six concurrent calls took 3.4 s, which is why a burst of
prefetches piled up to 3–7 s each.

Every other Supabase call in the traces cost 3–60 ms. The app was not slow; the harness
measured GoTrue.

**Fix:** the stack now signs sessions ES256 with a throwaway P-256 key (`GOTRUE_JWT_KEYS`), and
PostgREST verifies against a JWKS holding that public key and the HS256 secret (the fixed
anon / service keys stay HS256, as on Supabase). `getClaims()` now verifies locally, as it
does live.

## 2. The sidebar prefetched every section on every page

Every `<Link>` prefetches when it scrolls into view, and every section is dynamic, so each
prefetch renders the target's layout on the server down to its `loading.tsx`: profile +
`my_plan`, the onboarding marks, and under `(client)` the notification feed and unread count.
On `/library` the coach sidebar fired **10 prefetches** (11 renders, 66 Supabase calls
counting the page); on a phone the tab bar fires 5. At most one of them is ever used. In
production that is ~10 extra function invocations and ~20 sequential DB waves per page view.

**Fix:** sidebar, tab-bar and "More" sheet links are `NavLink` (`components/nav-link.tsx`):
`prefetch={false}`, and `router.prefetch(href)` on hover, focus or touch start, so the link
about to be clicked still gets its head start.

## 3. The layouts read in two waves where one would do

`(coach)/layout.tsx` awaited the profile, then read the onboarding marks; `(client)/layout.tsx`
awaited the profile, then the notifications, the unread count and the marks. None of those
depend on the profile. They now start alongside it: **one wave instead of two** on every page
and prefetch (~150 ms each in production at this box's ~120–160 ms per PostgREST call).

## 4. The refresh after an action — tried, and kept

`CoachingActions` calls `router.refresh()` after `transitionCoaching`, which already
revalidates the page it is called from. Before the fixes each pause / resume / end was a
7 s action followed by a 3.3 s refresh, so the refresh looked like a second render to drop.
It was tried: one run of the journey passed without it, but over 10 soak rounds the page kept
showing the old status after a pause or an end in **4 rounds** (action answered 200 in
42 ms, no error on screen, `data-status` stayed `active` for 15 s). The action's own response does not
reliably bring the new page here, so the refresh stays, as CLAUDE.md convention 2 says. With
§1 fixed it costs 6–60 ms locally, one page render in production.

## 5. Two hot reads asked GoTrue directly, in production too

`searchExerciseLibrary` (runs as the coach types in the library) and `getExerciseSummaries`
(every workout day page) called `auth.getUser()`, a GoTrue round trip on the live project
too. The id only marks "mine" and picks the coach's video links; RLS decides what is visible.
Both now use the request-cached `currentUserId()`. Left on `getUser()` on purpose:
`billing-actions.ts` and `/api/coach-documents/[id]` (Stripe, and private documents, where a
server-side session check is worth its round trip).

## Numbers

Local stack, production build, same machine, same seeded accounts.

| What | Before | After |
|---|---|---|
| coach `/dashboard` document | 1547 ms | 75 ms |
| coach `/library` document | 1523 ms | 52 ms |
| prefetches fired opening `/library` | 10 sidebar routes, 2.8–6.1 s each | 0 sidebar routes (5 exercise links in the page, 58–119 ms) |
| Supabase calls behind opening `/library` | 67 (11 × `/auth/v1/user` at 2.7 s avg) | 51 (1 × `/auth/v1/user`, then removed — §5) |
| server actions in the lifecycle journey | 1.9–10.5 s (median ~6.4 s) | 34–62 ms |
| `router.refresh()` after a lifecycle move | 1.2–5.8 s | 10–60 ms (kept, §4) |
| lifecycle journey, whole test | 1.7 min, failed 21 rounds in 29 | 4.2 s |

## Memory and the slowdown over rounds

SOAK_RESULTS

## Follow-ups

- **Finish workout can stay on `/log`** (solo journey, 2 rounds in 10, never in the 29 slow
  rounds): the router fetched `/done`, the done page even ran its action, but the navigation
  never committed and the button stayed pending. `router.push` runs inside the finish
  transition right after the set logger's own `router.refresh()`. A race that seconds-long
  responses used to hide. Same journey: the second set was saved as 40 × 10, not 45 × 8, so
  the spec's typing races the form's "same as previous" refill. Neither path is touched here.
