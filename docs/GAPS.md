# Gaps — spec vs. code

`PRODUCT_SPEC.md` and `DEVELOPMENT_PLAN.md` describe the intended product.
This is the honest diff against what is in the repo, so a future session doesn't
assume a feature exists because the spec (or the landing page) says it does.

Verified 2026-08-26; landing-page claims re-audited and several entries closed 2026-09-16.

## Structural

**No mobile app.** The plan's `apps/mobile` (Expo) does not exist. Every "client
app" screen is a web route in `apps/web/app/(client)/`. Three things are built
for it and unused: `supabase/functions/sync-ingest` (offline outbox),
`supabase/functions/push-dispatch` (`users.push_token` is never written by any
client), and `packages/shared/src/sync.ts`.

**The nutrition builder is partly proven — 2026-09-19.** Driven against the live
project as coach Andrei: `addPlanFood`, `removePlanFood` and
`publishNutritionPlan` all work, and the client then reads the plan under RLS
(verified both for a targets-only plan and for the seeded plan with 14 foods).
Still not exercised end-to-end: `createNutritionPlan`, `updatePlanFoodGrams`,
`addMealDayVariant` / `removeMealDayVariant`. The header comment in
`nutrition-actions.ts` is correspondingly narrower now.

**Tests cover domain math plus an end-to-end smoke layer.** Vitest is scoped to
`packages/**/src/**/*.test.ts`. Since 2026-09-29 Playwright (`npm run e2e`)
checks that every main coach and client screen renders, the auth redirects, roster
isolation between two coaches, and one write round trip (habit tick → reload →
untick). It runs locally only — CI has no dev server or live-project access —
and still does not cover the builders or `nutrition-actions.ts`. The one integration-level safety net is the pgTAP RLS suite
(`supabase/tests/rls_client_isolation.test.sql`, `signup_role.test.sql`,
`role_not_self_service.test.sql`) run in CI.

**No Apple sign-in, no onboarding.** Spec C1 promises email + Google + Apple
and an onboarding flow. Email + password and Google exist (sign-up, repeat
password, forgot/reset password, coach/client choice). Apple is required by the
App Store once any social login ships in a native app, and would be one more
`signInWithOAuth` provider redirecting to the existing `/auth/callback`. After
sign-up a user lands straight on their home screen with default units, locale
and check-in day — nothing asks.

## Nutrition

**1. ~~A plan is a single day, repeated forever~~ — closed 2026-09-16.**
`planned_meals.day_index` (`0 = every day, 1..7 = ISO weekday`) is now written
and read. The coach's builder offers "different on one day", which copies a meal
with its foods onto that weekday; the everyday version keeps covering the rest.
The client's diary resolves the day it is showing — browsing back to Saturday
shows Saturday's plan — and "ate as planned" logs the same resolution. The rule
is `mealsForWeekday` in `packages/shared/src/meal-days.ts`, with tests, because
the diary, the coach preview and the log must not disagree. Spec W6's
"duplicate day" for the plan builder is still only in the *program* builder.

**2. No recipes or composite foods.** A meal is a flat list of raw ingredient
rows. A coach who wants "chicken bowl" in five plans re-adds chicken + rice + oil
+ broccoli five times. There is no saved recipe entity that expands into
ingredients or logs as one item. See [DISHFINDER.md](DISHFINDER.md) — the sibling
project already holds 52k ingredient-indexed recipes.

**3. ~~No "ate as planned"~~ — closed 2026-09-16.** `logPlannedMeal` in
`app/client-actions-app.ts` re-reads the published plan server-side and logs the
whole slot in one tap; the button sits in `components/meal-card.tsx` and only
shows while the slot is still empty. Idempotent — `client_generated_id` is
derived from (user, day, slot, position), so a double tap upserts rather than
duplicating. Still missing from the C8 quick-actions row: recents, favourites,
copy-yesterday.

**4. One live plan per client.** `getMyPlanMeals` takes the single most recent
`published` plan. No date ranges, no history, no training-day vs rest-day
switching.

**5. No custom food form.** Spec C12. `foods` supports owner-scoped custom rows
and the schema is ready; there is no UI to create one, so a barcode miss
funnels to search and stops there.

## Engagement

**Badges are awarded** (2026-09-25, `award_badges_for()` and its triggers) and
shown on the social profile, but the catalog is twelve fixed thresholds — there
are no Fitness Score badges, because the score is computed in TypeScript and
the award runs in SQL. Streaks are live, but derived on the fly from completed
sessions (`lib/streak-data.ts`, `packages/shared/src/streaks.ts`), not from the
`streaks` table. `adherence_snapshots`: the formula exists in
`packages/shared`, the scheduled job that materialises weekly snapshots does
not.

## Coaching

**No realtime.** No Supabase channel subscription exists anywhere in the web app.
Messages and the kitchen-style live surfaces are all server-rendered reads
refreshed by `router.refresh()`.

**`coach_feedback` is half-wired.** The coach *does* write it: `reviewCheckIn`
(`app/actions.ts`) inserts a `check_in` row when the coach types a reply. Until
2026-09-16 no client screen ever read it — `getMyCheckInState` returned
`coach_feedback: null` hardcoded, so every reply a coach wrote was discarded on
arrival while the UI that displays it sat there in `/check-in` and `/today`.
Now read (one extra parallel query, no extra wave). **Per-set and per-session
feedback still do not exist** — nothing writes `reference_type` `set`,
`session` or `set_video`, so the landing page no longer claims it.

## Coach Discovery

**Database, server actions and the coach's onboarding UI** (2026-10-01). Migration
`20261020100000_coach_discovery_foundation.sql` (suite
`supabase/tests/coach_discovery.test.sql`) is **applied to the live project**.
Built: `coach_profiles` (1:1 with `users`), reference tables (`countries`, `cities`,
`languages`, `specializations`), `coach_specializations` / `coach_languages` /
`coach_locations` / `coach_services` / `coach_certifications` /
`coach_verifications`, `coaching_requests`, `become_coach()`, the draft →
pending_review → published lifecycle with admin RPCs, `search_text` /
`search_doc`, and `coach_public_profile(slug)` — the **only** function in the
database granted to `anon` that returns profile data. Writes:
`app/coach-profile-actions.ts`; reads: `lib/coach-profile-data.ts`; shapes:
`lib/coach-profile.ts`; wizard model: `lib/coach-onboarding.ts` (unit-tested).

UI: `/settings/coach-profile` (under `(coach)`, so clients are redirected) — a
six-step wizard (`components/coach-profile/`), step in `?step=n`, saved on
Continue / Back and by a 1.5 s debounced autosave on the field steps; services and
certifications save per row. Entry points: "Become a coach" on the client's
`/account`, a status card on `/settings`. Outside `draft` the page shows the status
and a read-only preview; "Edit profile" withdraws to draft. e2e:
`e2e/coach-onboarding.spec.ts`.

Public page (2026-10-01, migration `20261021100000_coach_public_profile.sql`, applied
live, suite `coach_public_profile.test.sql`): `/coaches/[slug]` — hero, about, specializations,
services with per-service Start coaching, certifications (verified badge only when an admin
verified it), posts and public routines, follow, a sticky phone CTA, `generateMetadata`
(title / description / canonical / Open Graph / Twitter) and schema.org `ProfilePage` JSON-LD.
`components/coach-profile/preview.tsx` (`CoachProfileView`) is both the public page and
the onboarding preview. Start coaching sends `request_coaching()`; a pending request can be
cancelled from the page. **Anonymous readers get post text and counts, never post photos**
(`/api/media` requires a session); signed-in readers get the Social V2 `PostCard`. e2e:
`e2e/coach-public-profile.spec.ts` — the published-page tests need `E2E_PUBLISHED_COACH=<slug>`
and a published coach on live (none exists yet; they were run against the seeded coach
published temporarily, then restored).

Discovery (2026-10-01, migration `20261022100000_coach_search.sql`, applied live, suite
`coach_search.test.sql`): `/coaches` — search (tsvector prefix match + substring + pg_trgm
typo tolerance, unaccented), filters (country, city, online / in person, specializations — any
of, experience 1/3/5/10+, price range in RON on public prices only, accepting clients — on by
default), sorts (recommended = accepting → completeness → verified → relevance → followers →
newest; relevance; most experienced; most followed; newest), 24 per page with a crawlable
"Load more" link (`?page=n`, up to 10). All state in the URL (`lib/coach-discovery.ts`);
filtered URLs are `noindex`. `rank_score` is still never written and not used. e2e:
`e2e/coach-discovery.spec.ts` (cards need `E2E_PUBLISHED_COACH`).

Discovery Home (2026-10-05, migration `20261026100000_coach_search_viewer.sql`, applied live
2026-10-05, no drift after): bare `/coaches` is now a home page, not the listing —
hero + search + city picker, quick filters (Near me, Online, In person, four specializations;
all plain links into the listing), "Recommended coaches" (the same deterministic `recommended`
order, first 8; it falls back to coaches not taking clients before saying "no coaches"),
"Coaches near you" and "Explore by specialty". `?all=1` (`DiscoveryQuery.browse`) is the bare
listing; any search or filter is the listing too. **Near you is only the free-text
`users.city`** from the reader's profile, matched to a city that has a coach
(`matchViewerCity`: exact name in either language, or a unique prefix — "Cluj"). No
geolocation, no gym-based proximity. Anonymous readers get a city picker instead. Coach cards
carry the existing `FollowButton`: the migration adds `user_id`, `is_self`, `is_following`,
`follows_me` to `search_coaches()` items **for signed-in callers only** (anonymous output
unchanged), and puts `coach_locations.gym_name` into `search_text` (search by gym). The home
with real coach cards has not been checked against the live project yet (no published coach
there; the published-coach e2e cases skip). Not built: personalised recommendations, specialization counts on the tiles,
"coaches at your gym" on the home (`gym_coaches_at()` exists).

Search & filters v2 (2026-10-05, migration `20261027100000_coach_search_filters.sql`, **not
pushed live** at the time of writing): `search_coaches()` gains `p_verified` (an accepted
`coach_verifications` row), `p_hybrid` (online AND in person) and `p_gym` (a
`coach_locations.gym_id`); `coach_discovery_facets()` returns `gyms` (active gyms with a
published coach). Followers on a card no longer count accounts with a pending deletion. The
app sends the three new arguments only when set, so everything else keeps working before the
push; `?verified=true`, `?hybrid=true` and `?gym=` return 500 until it lands, so **push the
migration before deploying this code**. In the listing, removing the last filter, Clear all and
emptying the search all stay in the listing (`?all=1`) instead of jumping to the home. Not
filterable (no structured data): languages are stored (`coach_languages`) but have no filter
yet; there are no ratings/reviews, no price-per-session normalisation across units, no
distance (gyms have lat/lng, coaches do not), no availability calendar. Lint: the repo has no
ESLint config (`next lint` only offers to create one).

Public coach page v2 (2026-10-05, migration `20261028100000_coach_public_hardening.sql`, **not
pushed live** at the time of writing). Privacy: `coach_public_programs()` (anonymous) returned
whole `program_card_rows()` rows — coach_id / client_id / author_id (the coach's account id) and
source_program_id; they are now null. `coach_viewer_state()` now refuses suspended, deleting and
blocked coaches like `coach_public_visible()`. `stats.programs` (exact count of the public
programs the page lists) is new. Page: mobile order identity → actions → specializations → about
→ facts → services → certifications → programs → posts → "Why train with …" (built only from
real fields: verification, experience, specializations, service / program / post counts — no
ratings, client counts or outcomes, none of which exist); `@username`; "Hybrid" when a coach is
online and in person; empty About / headline are left out on the live page (placeholders stay in
the onboarding preview); anonymous reads run in one wave; signed-in posts / programs stream
behind `CoachSectionSkeleton`. **No route `loading.tsx` on purpose**: it starts the response
before `notFound()` and turns the 404 into a 200. `app/coaches/[slug]/not-found.tsx` is the same
page for unknown, unpublished, suspended and blocked. Open: a signed-in not-found intermittently
500s app-wide on the dev server (`useI18n must be used inside <I18nProvider>`, also on
/achievements and /exercises) — not coach-specific. `/people/[id]` does not yet link to a coach's
page (needs the slug in the social profile read). Reviews, ratings and booking do not exist.

Onboarding v2 (2026-10-05, migration `20261029100000_coach_hide_and_review.sql`, **not pushed
live** at the time of writing). Pre-moderation kept (the user, 2026-10-05). New: the coach's own
**Hide / Show** switch — status `hidden`, published ↔ hidden instantly with no new review, because
content is locked outside draft; Show re-runs `coach_profile_missing()` and refuses (staying
hidden) if e.g. the photo was removed; withdraw works from hidden. Every public door already
requires `published`, so hidden leaves search, facets, the page and requests at once. The admin
review UI exists: `/admin/coaches` (queue by status, counts) and `/admin/coaches/[id]` (the
profile drawn with the public page's component via `admin_coach_review()`, plus Approve / Send
back with a note / Take offline / Suspend / Restore — exactly the transitions SQL allows, each
audited). Approving never verifies. The publish checklist shows certifications and cover as
optional ○ rows. Until the migration is live the two admin pages read nothing (the RPCs do not
exist) — push before deploying. The coach is not notified of a decision (they see it on
/settings/coach-profile); verification has RPCs but no admin UI yet.

Services / offers (2026-10-06, migration `20261031100000_coach_service_offers.sql`, **not pushed live** at
the time of writing). `coach_services` extended, not duplicated: `delivery` (online / in_person / hybrid /
digital), `duration_value` + `duration_unit` (minutes / days / weeks / months, both or neither), kinds
`training_program` and `training_nutrition`, currency limited to RON/EUR/USD/GBP/MDL. `price_unit` gains `free`,
`week`, `year`; the pricing model is derived from it, never stored (`pricingOf()` in lib/coach-onboarding.ts):
free · one-time (session, package) · recurring (week / month / year = billing period) · on request (custom).
Content still changes only in draft (pre-moderation); switching a service on/off and reordering are operational
and work in review / published / hidden through `coach_set_service_active()` / `coach_reorder_services()` — the
"Your services" card on /settings/coach-profile — and the last active service of a non-draft profile cannot be
switched off. The public page shows delivery, duration and Free; its per-service CTA is the existing Start
coaching request (no payment, no booking). Until the migration is live, /settings/coach-profile cannot read the
new columns — **push before deploying**.

Verification & trust (2026-10-06, migration `20261101100000_coach_verification.sql`, **not pushed live**
at the time of writing). "Voinic Verified" = `coach_profiles.verification_status = 'verified'` and nothing
else: unverified → (coach: `request_coach_verification()`, complete profile required) → pending → (admin:
`admin_set_coach_verification_status()`) → verified | rejected (reason shown to the coach); rejected → pending;
verified → rejected = revoke. Coaches never write it. Credentials (`coach_certifications`) gain
`credential_number` (owner/admin only, never public) and `expires_on`; each stays "provided by coach" until an
admin verifies it (`admin_set_certification_status`); any edit resets it. One reusable badge,
`components/coach-discovery/verified-badge.tsx`, on the search card and the public page; the per-kind
`coach_verifications` rows only add a "checked: identity · …" line under it. Search ranking unchanged (verified
stays one tie-breaker). Admin: a verification panel on /admin/coaches/[id] and a "Verification requests" queue
(`?verification=pending`). Credentials are still editable in draft only (pre-moderation). Not built: KYC,
document upload (`document_ref` exists, unused), external registry checks, notifying the coach of a decision.

Saved coaches (2026-10-06, migration `20261102100000_coach_saves.sql`, **not pushed live** at the time of
writing). A private shortlist, not Follow: `coach_saves` (user_id, coach_profile_id, created_at; primary key on the
pair), owner-only select / insert / delete, no update, nothing for anon; a trigger refuses saving yourself
(CANNOT_SAVE_SELF) and the insert policy refuses a coach the saver cannot see (`coach_saveable()`). No save count
exists anywhere. `search_coaches()` gains `p_saved`, a `saved` sort and, for signed-in callers, `is_saved` per card
(one query, no request per card); `coach_viewer_state()` gains `is_saved`. UI: `SaveCoachButton` (bookmark) on every
card and beside Follow on the profile, sign-in link for anonymous readers, `/coaches/saved` (static segment;
"saved" is a reserved slug), a header link for signed-in readers. A coach who goes hidden or suspended drops out of
the list (the row is kept); a deleted profile or account cascades.

Contact requests (2026-10-06, migration `20261103100000_coach_contact_requests.sql`, **not pushed live** at the
time of writing). `coaching_requests` extended (goal, preferred_format), not duplicated. **Two steps, decided
2026-10-06**: Accept = "let's talk" — status only, the client is notified, nobody becomes a client;
`start_coaching_from_request()` on an accepted request is the explicit second step (trainer_clients + conversation,
one-active-coach rule, the plan's client limit in the action). Contacting no longer requires having no coach. Notices
go into the existing notifications table, category `coaching_request` with payload.event (sent / accepted / declined /
cancelled) and payload.screen, gated by social_notify_ok(). Reads: `coach_requests(status)` (public name, username,
avatar and what the request carries — no city, no e-mail) and `my_coaching_requests()`; `coach_viewer_state()` gains
last_request. UI: the profile CTA is "Contact coach" / Request sent / Request accepted / Contact again; the dialog asks
for a message (required), an optional service, goal and format; /requests (coach, nav item) and /coaches/requests
(client). The gyms inbox card stays, with corrected copy and a link to /requests. "requests" is a reserved slug.

Marketplace trust, ranking & analytics (2026-10-07, migrations `20261110100000` → `20261110130000`, **not pushed live**;
apply all four, in order, before the code — search_coaches is redefined, and the admin pages, the beacon and the
Performance card answer empty without them). Not built: sign-up attribution for Google OAuth sign-ups (no metadata
on that path), response *time* as a signal (only "answered within 48 h"), per-step conversion
rates (counts only, by design until the log is old enough), an admin test account to drive the admin pages.

Discovery 2.0, profile content, landing pages, calendar foundation (2026-10-08, migrations `20261111100000` →
`20261111130000`, **applied live** — checked 2026-10-08 in the SQL Editor: all four are in
`supabase_migrations.schema_migrations` and their objects exist (`coach_profiles.approach` / `search_wdoc`,
`marketplace_events.detail`, `calendar_connections`). `search_coaches()` and `marketplace_track()` were dropped and
recreated with new arguments, and `/bookings/availability`, the profile editor and the public page read the new
functions). See docs/ENGINES.md §Discovery 2.0 and §Calendars.
Not built: **any calendar provider** — no Google / Microsoft adapter, OAuth callback route, token key
(`CALENDAR_TOKEN_KEY`) or sync worker exists, so "Connect" is "coming soon" and no coach can connect; the
database, the slot blocking, the encryption, the sync logic and the status card are ready for them. Provider
push channels (watch / subscriptions) and their renewal. Distance search (coaches have no coordinates).
Portfolio media beyond the existing public posts (no new media system: posts with pictures are the portfolio;
anonymous readers still see post text only). A noindex for a landing page whose only coaches stopped taking
clients (it stays indexable while it has a published coach). Landing pages for city × specialization pairs.
The e2e spec `marketplace-discovery.spec.ts` has not been run against a live project yet.

Launch readiness (2026-10-08, migration `20261112100000`, **applied live** — checked 2026-10-08 with the four
above: in the migration history, `admin_coach_attention()` exists). Not built, on purpose until monetization or later: payments of any kind, paid placement
(`placement` stays 0), an expiry for pending bookings (one still holds its slot until the coach answers), a 410 for
removed coaches (404 today), a review prompt for coaching relationships (only completed sessions prompt), filtering the in-app
notification list by preference (push already honours `users.notification_prefs` per category in `push-dispatch`,
and the new notices use the existing `marketplace` / `booking` categories), an admin test account for the admin e2e. The marketplace has not been driven in a browser against a live
project in this pass (no credentials in the session that built it): every e2e spec compiles and lists, none ran.

Coaching lifecycle (2026-10-07, migrations `20261109100000` + `20261109110000`, live since 2026-10-07). Not built: a coach-side
"End coaching" from the active client page itself (it links to the relationship page), invite-path start notice,
per-relationship review (one review per client and coach, by design).

Marketplace operations (2026-10-07, migration `20261108100000_coach_marketplace_ops.sql`, **not pushed live** —
/marketplace and the revision editor need it; the unpushed chain is 20261104 → 20261108, all before the code). Not built:
profile-view analytics, response rate, a notice to the coach when an admin decides a revision or a profile, a
reviewed cover change for live profiles, booking intent for a client-only service through sign-in (the booking page
itself already returns there), payments (last).

Public directory & SEO (2026-10-07, migration `20261107100000_coach_public_seo.sql`, **not pushed live** —
everything degrades without it: no slug redirects, a sitemap of the two static pages). See docs/ENGINES.md. Not built:
city / specialization landing pages, a generated Open Graph card (the cover or avatar is used), a short bio on
Discovery cards, image resizing for avatars (plain Cloudinary URLs), hreflang (locale is a cookie, one URL per page).

Reviews (2026-10-07, migration `20261106100000_coach_reviews.sql`, **not pushed live** at the time of writing —
the coach's /reviews and /coaches/[slug]/review need it; the public page, the Discovery cards and the admin queue
degrade to "no reviews" while it is missing). See docs/ENGINES.md §Reviews. Not built: ranking by rating (the stats are
on the search rows, unused in the order), a gentle "Review your coach" prompt on /coach for long-running clients,
response rate / booking activity metrics, a general admin reports inbox (only review reports have a reader).

Bookings (2026-10-07, migration `20261105100000_coach_bookings.sql`, **not pushed live** at the time of writing —
/bookings, /bookings/availability, /coaches/bookings and the book page call its RPCs and tables, so it must be applied
before the code deploys; the public coach page alone degrades to no Book buttons). See docs/ENGINES.md §Bookings.
Not built: payments, calendar sync (Google / Apple / Outlook), recurring appointments, group classes, an expiry for
pending bookings (one holds its slot until the coach answers), per-service availability (every bookable service of a
coach shares their one week), cross-coach time-zone conversion for the viewer (times are shown in the coach's zone).

Request → conversation (2026-10-07, migration `20261104100000_request_conversations.sql`, **not pushed live** at the
time of writing — the inbox and thread pages call its RPCs, so it must be applied **before** the code deploys). An
accepted request opens the pair's existing conversation (Message coach / Message client); see docs/ENGINES.md
§Coaching. Not built: withdrawing an *accepted* request (cancel stays pending-only, as decided 2026-10-05 — a client
who wants out blocks), realtime delivery, attachments.

Not built: sitemap / robots, city / specialization landing pages, notifications for coach-profile
decisions and for requests (the coach has no inbox for them yet — requests are only in
the table), certification document upload
(no private storage path yet), reviews, booking, payments.
**`accept_coaching_request` does not exist**: what happens to a client who
already has an active coach (`one_active_coach_per_client`) is an open product
decision. **Content is editable only in `draft`**: a published coach who wants
to fix a typo withdraws (page goes offline), edits, and resubmits — staged
revisions would remove that, later. The submit e2e is skipped while the seeded
coach has no profile photo (an upload cannot run in a spec).

## Paid tiers and the landing page

**The paywall is built but switched off** (2026-09-23, see ENGINES.md →
Accounts, billing, admin). Every flag in `ENTITLEMENTS` now has a gate behind
it, but `app_flags.paywall` is off, so nobody is limited and there is still no
way to pay: `/billing` redirects to `/account` until the switch is on for that
person. What turning it on still needs: Stripe set up live
(`scripts/stripe-setup.mjs`, webhook endpoint, secrets — never verified on
this project), the billing page's own strings moved into i18n (the feature
lists are; the rest of `components/billing.tsx` and `/billing` is English),
and a look at every gated screen as a free and a Starter account — the gates
were typechecked and the SQL tested live, but no screen was seen rendered
gated. Share cards keep the brand on every plan; Premium buys Edit Stats, the
square format and hiding the profile, not a card without the logo.
The landing page's pricing copy (`pricingTiers`, not rendered today) was
rewritten to match the gates; no line is "soon" any more.

**Offline: sets only, and only on an open logger.** Since 2026-10-01:
- The service worker (`app/sw.ts`, Serwist) precaches the build's assets and an
  `/offline` page, so a screen that cannot load shows that page instead of the
  browser's error. Screens are never cached (one person's data), so nothing
  *opens* offline — the set logger has to be on screen when the signal goes.
- A set logged with no connection goes to an IndexedDB outbox
  (`lib/offline/outbox.ts`), shows with a "not synced" clock, and is replayed
  through the same `logSet()` action by `lib/offline/sync.tsx` (mounted in
  `(client)/layout.tsx`) on `online`, on tab focus and every 20 s. `logSet` is
  idempotent — deterministic session and set keys, a replay of a set already
  on record answers ok — and takes the set's own `loggedAt`, so a set queued
  before midnight stays in that evening's session. Items carry their user and
  replay only for that user. Finish waits for the outbox. `e2e/offline-sets.spec.ts`
  drives both the offline case and the lost-answer replay.
- Not covered: food logs, habit ticks, edits, check-ins — they still fail
  without a connection. iOS replays only when the app is opened again (no
  background sync). `sync-ingest` / `packages/shared/src/sync.ts` stay unused:
  they are the outbox endpoint for a native app, which the web does not need,
  and `sync-ingest` predates `logged_sets.rir` (it would drop it).
- The landing page claimed "offline logging" until 2026-09-16; it still should
  not, at this scope.

**Rest-timer push: pipeline live, device delivery unobserved.** The Web Push
path (migration `20260919100000`, edge function `rest-push`, cron
`rest-push-tick`) was fully set up on production on 2026-09-19 and driven
through to the function claiming a due row. No real phone has yet been seen
receiving one (the dev browser pane denies notifications); the first person
to enable notifications on `/account` from a normal browser will be that
test. `push-dispatch` (Expo) remains unused — the web push is a separate,
smaller path.

**No marketplace email (2026-10-09: designed, not built).** Requests, bookings, reminders, messages,
reviews and listing decisions reach people in-app only. The design, event map, outbox proposal, GDPR split
and the steps before switching it on are in [MARKETPLACE_EMAIL.md](MARKETPLACE_EMAIL.md); the send/skip/wait
policy is code and tested (`packages/shared/src/marketplace-email.ts`). Missing: the outbox table, the
dispatcher function, templates, a preferences UI and unsubscribe links — and a provider.

**Launch-audit follow-ups (2026-10-08).** Three gaps from the audit closed in code:
- **Consent at sign-up** — migration `20261113110000_signup_consent.sql`: `users.terms_accepted_at`,
  `health_data_consent_at`, `consent_version`. The sign-up form has two separate boxes (Terms + Privacy;
  explicit GDPR Art. 9 health-data consent, `components/consent-checks.tsx`) and sends
  `consent_version` as metadata, stamped by the `on_auth_user_created_consent` trigger. Every other
  account (Google, everyone from before) is sent to `/complete-profile` by both layouts while
  `consent_version` ≠ `CONSENT_VERSION` (`lib/legal.ts`), which records it via `accept_consent()`.
  Bumping `CONSENT_VERSION` asks everyone again. The /terms and /privacy *texts* are still the
  26 Aug drafts with placeholders — that is the lawyer's half of the audit item, not done.
- **Custom exercises private** — migration `20261113100000_custom_exercises_private.sql`:
  `exercises_select` was `using (true)`; now the library, your own, and any custom exercise that a
  program, logged set or challenge you can already see points at.
- **GDPR export complete** — `lib/data-export.ts` now also carries bookings, coaching requests and
  relationship events (either side), reviews (written and received), saves, the coach profile with
  its services / certifications / languages / locations / revisions, availability, calendar
  connections (never tokens), social stories / blocks / mutes / reports / saves, and coach-authored
  programs and plans. Ten of those tables have no select grant, so they come from
  `export_my_restricted_data()` (migration `20261113120000`, without admin notes, admin ids or
  whom a report was about). The coach's `/settings` now carries the export and delete cards too.
- **Sign-in from a coach page lost `next`** (found by the first full e2e run): `LoginForm` read
  `window.location` while rendering, which after a client-side `<Link>` is still the previous URL,
  so Contact / Save / Book / Follow → sign in landed on `/dashboard`. Now read in an effect.
- **All three migrations above are applied live** (2026-10-08, relu approved).
- **Slow coach page** — `coach_public_profile()` took ~1.5 s (anon timeout is ~3 s, so the page
  500'd under load). Cause: `booking_timezone_valid()` read `pg_timezone_names`, which walks the
  whole tz database on disk (~390 ms) and ran once per page plus once per bookable service, in
  every booking path. Migration `20261113130000_timezone_lookup_fast.sql` (live) caches the names
  in `timezone_names` with the catalog as fallback on a miss: the RPC is ~21 ms now.

**~~No GDPR export or account deletion~~ — closed 2026-09-16.** `/account` carries
both: `downloadMyData` (lib/data-export.ts) hands the browser one JSON file with
every row the account owns, and `requestAccountDeletion` calls the
`request_account_deletion()` RPC that has sat unused since migration
`20260823001200`. The purge job is migration `20260916110000_account_purge.sql`:
`purge_deleted_accounts()` on a daily cron, plus a tightened
`request_account_deletion()` that also replaces the searchable username.
It is live (checked 2026-10-08: `purge_deleted_accounts()` and the
`purge-deleted-accounts` cron job both exist). Covered by
`supabase/tests/account_purge.test.sql`, which also pins the case that made a
naive delete impossible: a coach's custom exercise sitting inside a client's
program (`program_exercises.exercise_id` has no cascade), so the job reassigns
those exercises to the system library instead of letting them cascade.

**~~No client settings screen~~ — `/account` shipped 2026-09-16** with name,
username, time zone, check-in weekday and leaderboard visibility. The last one
mattered most: `users.leaderboard_visibility` defaults to `'public'` in SQL and
the migration that added it says "No UI", so every client was ranked publicly
without ever choosing to be.

**Units shipped 2026-09-16.** `weight_unit` / `length_unit` are honoured
everywhere a weight or a circumference is shown or typed. The rule is in
`packages/shared/src/units.ts` with tests: storage stays metric and conversion
happens only at the edges, so no sum, chart or leaderboard has to know which
unit a row was entered in. The client shell carries a `UnitsProvider`
(`lib/units/client.tsx`) shaped like the i18n one; server components read the
unit off the profile instead.

The inputs mattered more than the displays — the set logger, the set editor,
the weigh-in, the check-in, the feed's weight box and the program builder all
convert on the way in, and the logger's pre-filled coach target converts on the
way out, which would otherwise have put 100 into a pound box and logged 45 kg.

Still without a control: `notification_prefs`. **Coach surfaces remain metric** —
the coach shell has no UnitsProvider, so the default applies there.

**`/get-the-app` is orphaned** — nothing links to it, and it described an Expo
app that does not exist. Rewritten 2026-09-16 to describe the web app.

**`ClientToday.unread_from_coach` is hardcoded `0`** (`lib/client-today.ts`) and
read by no component — dead either way.

**Challenges and leaderboards, 2026-09-16.** Clients can now create their own
challenges (`createChallenge`): the schema and its policies supported it from
the start — `creator_id`, `visibility`, `challenges_owner_insert` — only the
form was missing, so the four seeded platform challenges were all anyone could
join. Leaderboards gained a `following` scope, which needed migration
`20260916120000_leaderboard_following.sql` because `social_leaderboard()`
validated `p_scope` against `'global'` alone. The scope narrows the visible set
and never widens it: someone private stays off the board even if you follow
them. **Not applied to the live project yet.** The `gym` scope exists since
20261023100000 (below); `club` is still unbuilt.

**Progress photos shipped 2026-09-16.** Storage is Cloudinary
(`lib/cloudinary.ts`), not Supabase Storage. Assets are `type: authenticated`
and delivered through signed URLs that expire after 30 minutes, because a
public `upload` asset is readable for ever by anyone who gets the URL. Uploads
are signed per asset — the browser posts straight to Cloudinary with a
signature this server issued for one folder and one public_id, so an image
never crosses a server action's body limit and cannot land anywhere else.
`progress_photos.storage_path` holds the public_id, never a URL, since a signed
URL is a dead link by the time anyone reads it back.

Account deletion removes the assets too (`destroyUserPhotos`), at request time
rather than at purge time: the SQL job cannot reach object storage, the request
cannot be cancelled, and holding someone's body photos for the 30-day window
after they asked for deletion serves nobody. Needs
`CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET`, all server-side; without
them the section renders a "not configured" note instead of a broken upload.

## Known small ones

- `lib/data.ts:124` — `previous: null // TODO: fetch previous week in one query`,
  so week-over-week deltas on the coach dashboard are absent.
- Admin coach/client view switching no longer exists — `lib/view-mode.ts` went
  with demo mode on 2026-09-14. A live equivalent is a real access-control
  decision about health data and should not be added casually.
- **There are no set types.** `logged_sets` has no warm-up / drop / failure
  column, so exercise analytics counts every logged set as a working set: a
  warm-up single at 40 kg is in the volume total and in the session's set count.
  Adding the column is a schema change plus a logger affordance plus a decision
  about what to do with the sets already stored, and was deliberately left out
  of the 2026-09-22 analytics work rather than half-done.
- **Muscle analytics stop at the exercise page.** `exercises.primary_muscles` /
  `secondary_muscles` are shown on `/exercises/[id]`, and the analytics rows
  carry what weekly-sets-per-muscle, volume-per-muscle and muscle balance would
  need — but nothing aggregates across lifts yet. The honest blocker is that
  the schema has no per-exercise muscle *weighting*, so a set of chin-ups would
  count once for lats and once for biceps as if they were equal work.
- **Workout / PR / streak post payloads are built by server actions, not
  re-derived in SQL.** The Fitness Score (since 20260930130000) and achievement
  posts are recomputed by the database; the other data posts still trust the
  action that built them, so an owner calling PostgREST directly could post a
  workout tile about themselves that no session backs. It can only misstate
  their own activity, never read anyone else's.
- **The admin panel's training-load numbers are not the app's.** Three
  rollups in `20260920100000_admin_panel.sql` (`admin_users` load_7d, the
  `admin_overview` load bands, `admin_challenge_detail` load) average
  `ls.rpe` alone — a set logged with only an RIR has no intensity there — count
  `reps = 0` sets, let a negative weight subtract volume, and window challenges
  on `started_at::date` (UTC) rather than the member's timezone. None of them
  turns a missing intensity into 1 (`avg` skips NULLs), so they were left out
  of the 20260930140000 fix; aligning them means routing them through
  `effective_rpe()` and the same rollup the challenges use.
- **SQL challenge / leaderboard rollups count exercises over `reps > 0` sets
  only**; `loadOf()` counts every exercise on the session. A session where an
  exercise has only `reps = 0` sets scores one exercise fewer in SQL. Not a
  NULL issue, so not changed with the intensity fix.
- **Two visibility settings overlap.** `leaderboard_visibility` still governs
  leaderboards on its own; `stats_visibility` governs the profile. Someone with
  private stats and a public leaderboard entry still appears on the board.
- **Comment replies stop at one level**, by constraint rather than by omission
  (`social_comment_depth_guard`). Threading deeper needs a different renderer
  than a single indent, and a decision about what a phone shows.
- **Gyms, 2026-10-02 (`20261023100000_gyms.sql` + `20261024100000_gyms_coach_discovery.sql`,
  both applied live).** An admin-curated `gyms` table (users can suggest;
  `/admin/gyms` approves, and a pasted Google Maps link prefills name + pin),
  `users.home_gym_id` with an opt-in `gym_board`, and the `gym` leaderboard
  scope (reciprocal: only someone on the board sees it). Unified with Coach
  Discovery: a coach is "at a gym" through `coach_locations.gym_id` (picked in
  the profile editor's Where step, so the claim is reviewed with the profile),
  "Coaches at your gym" on /coach lists published profiles there, and every
  request is a `coaching_requests` row, accepted by `accept_coaching_request()`
  into the same `trainer_clients` + conversation `accept_invite()` creates.
  One active coach per client stays: `request_coaching()` refuses
  ALREADY_HAS_COACH, and accepting a request whose client found a coach
  meanwhile closes it (`status = 'closed'`). The coach's inbox is on
  /dashboard and /clients. Still missing: **a map** (no provider chosen;
  `lat`/`lng`, `google_place_id`, `osm_id` wait for it), **a notification** when
  a request arrives, a link from `gyms.city` to `cities`, and gym filters in
  coach search.
- **Nothing shares outside the app yet.** `lib/share-payload.ts` builds the
  card data for every post kind, but no button calls it and no image is
  rendered from it; §19 asked for the infrastructure, not the integration.
- **The feed cursor is `created_at` alone** (`social_feed`'s `p_before`). Two
  posts with the identical timestamp at a page boundary would lose one. The
  notifications center moved to a `created_at|id` cursor for exactly this; the
  feed has not, because posts are written one at a time.
- **Routine templates are a shelf, not a catalogue.** The library ships with no
  seeded programs: Discover shows whatever real people have published, and is
  empty on a fresh deployment. A seeded set (PPL, Upper/Lower, 5/3/1, Full
  Body) needs nothing new in the schema — a system account owning public
  programs would appear in Discover exactly like anyone else's.
- **Routine ratings do not exist.** The card has room for one and
  `discover_programs` sorts only by `created_at` and `copy_count`, both real
  counts. Ratings would need their own table and a sort key; nothing was faked
  in the meantime.
- **A coach cannot publish a template.** `programs_shareable_only_solo` allows
  a non-private visibility only when `coach_id is null`, because a coach
  program belongs to one named client. A coach publishes from their own
  training account instead. If coach-authored public templates are wanted, that
  is a nullable `client_id` plus a rewrite of every policy that assumes it —
  deliberately not attempted here.
- **`program_usage` counts sessions across every copy.** That is the honest
  answer to "is anyone training this?", but it means a routine's author sees a
  number that includes strangers' sessions. Only aggregates are exposed, never
  identities; `program_assignees` (which does name people) is restricted to the
  coach who authored the source.
- Bodyweight exercises log `weight_kg = 0`, so their volume is 0 and they
  produce no 1RM. Nothing infers a body weight from `measurements` to fill the
  gap, and analytics does not pretend otherwise — `relevantOneRm` returns null
  rather than a number built on a guess.
