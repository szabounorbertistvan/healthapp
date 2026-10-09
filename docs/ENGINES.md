# Engine map

What each part of HealthApp does, which files hold it, and how finished it is.
Read [../CLAUDE.md](../CLAUDE.md) first for the conventions all of these follow
(single-branch Supabase actions, `ActionResult`, cookie i18n, RLS).

Maturity legend: **solid** = exercised against a live database, **unproven** =
the code is written and RLS-guarded but has never run against one, **stub** =
partially wired, **missing** = spec'd but not written.

Demo mode was removed on 2026-09-14, so "unproven" no longer has a working
fallback behind it — an unproven path is simply untested.

---

## Training

| | |
|---|---|
| Coach | `app/(coach)/programs`, `programs/new`, `programs/[id]` |
| Client | `app/(client)/workout` (every published program, coach's and own), `workout/[dayId]` (day overview + that day's history), `workout/[dayId]/log` (set logger), `workout/build` (solo builder) |
| Writes | [app/builder-actions.ts](../apps/web/app/builder-actions.ts) (incl. `removeProgramDay`), `createCustomExercise` in [library-actions.ts](../apps/web/app/library-actions.ts), `logSet` / `finishWorkout` in [client-actions-app.ts](../apps/web/app/client-actions-app.ts) |
| Reads | `getPrograms` / `getProgram` (data.ts), `getMyProgramGroups` / `getMyProgramDays` / `getWorkoutDay` / `getWorkoutDayHistory` / `getMySessions` / `getMyPrs` (client-data.ts) |
| Tables | `programs → program_days → program_exercises`; `logged_sessions → logged_sets` (`rpe` = felt intensity 1..10, `rir` = reps in reserve as typed, `notes` = per-set comment) |
| Components | `program-builder.tsx`, `exercise-picker.tsx` + `new-exercise-form.tsx`, `workout-day-list.tsx` + `swipe-to-delete.tsx`, `workout-history.tsx`, `set-logger.tsx` |

Coach builds program → days → exercises (sets/reps/rest/tempo/notes), can
duplicate a day, then publishes. Training lists every published program the
client holds (coach's first, then their own; `pickProgram` still decides which
one Today and adherence follow). Tapping a day opens its overview and the
history of past sessions of that day, set by set; "Start workout" goes to the
logger, where each set takes kg / reps / RIR, a 1–10 intensity slider and a
note. A day in the client's own program can be swiped left (or trashed with the
mouse) and deleted after confirmation. Anyone can create a custom exercise from
the picker (`exercises.owner_id` set, `source = 'custom'`). PRs are computed in
`packages/shared/src/prs.ts`.

**Maturity: solid.** Driven end-to-end against the live project on 2026-09-14 —
create a program for a client, add a day, add an exercise from the 888-row
library, set sets/reps/RIR/rest, publish, and confirm it reaches the client's
Today. RLS and column grants all held; `mutated()` guards every update/delete.

### Social v2 (added 2026-09-24)

| | |
|---|---|
| Client | `/feed` (scopes: following · all · mine), `/feed/[postId]`, `/people` (search + suggestions), `/people/[id]` (tabs + mutuals), `/notifications` |
| Reads | [lib/social-data.ts](../apps/web/lib/social-data.ts) — `getPost`, `getComments`, `getMentionCandidates`, `getSuggestedPeople`, `getMutualFollowers`; [lib/notifications-data.ts](../apps/web/lib/notifications-data.ts) gains actors |
| Writes | `addComment(postId, body, parentId)`, `mentionCandidates`, `loadComments` in [app/social-actions.ts](../apps/web/app/social-actions.ts); `markNotificationRead` in `client-actions-app.ts` |
| Maths | [packages/shared/src/mentions.ts](../packages/shared/src/mentions.ts) — `extractMentionHandles`, `commentSegments`, `mentionQueryAt`, `applyMention`, `resolveMentions` |
| Migration | `20260930110000_social_v2.sql` |
| Tables | `social_comments.parent_id`, new `social_comment_mentions`. Two new notification categories |
| Components | `comment-thread.tsx`, `notification-list.tsx` |
| Tests | `mentions.test.ts` (27), `share-payload.test.ts` (13), `supabase/tests/social_v2.test.sql` (37 pgTAP) |

**Replies are one level deep**, enforced by `social_comment_depth_guard()` —
a reply answers a top-level comment, on the same post, and cannot itself be
replied to. Arbitrary nesting is unrenderable on a 375px phone.

**Mentions are rows, not parsing.** The body keeps the literal `@maria` text;
`social_comment_mentions` holds the resolved ids. `commentSegments()` returns
an array of text and mention pieces that React renders as elements, so there is
no string containing markup for anything to interpret — a comment containing
`<img onerror=…>` renders as those characters. A handle links only when a row
says so.

**A mention grants nothing.** `notify_new_mention()` asks the post's visibility
question *as the mentioned person* before writing anything, so naming somebody
in a comment on a private post is silent and leaves no trace in their bell.

**Comment notifications**: the post's author gets `new_comment`, the parent
comment's author gets `comment_reply`, nobody gets notified of their own
typing, and one comment produces at most one notification per person — being
both replied to and mentioned is one ping, the reply.

**Read state is explicit.** Opening the bell no longer marks everything read —
it used to, which destroyed the only thing unread is for. A row is read when it
is followed (`markNotificationRead`), or by the explicit "mark all as read".

**Feed scopes widen who is listed, never what is visible.** `social_feed()`
grew `p_scope` and `p_type`; the visibility predicate is applied on top of all
three scopes in SQL. `social_post()` replaced a `getPost` that fetched fifty
posts by the same author and scanned for the one it wanted.

**Suggestions are counted, not modelled**: people followed by the people you
follow, most shared connections first. No affinity score, nothing that cannot
be explained in one sentence to the person seeing it.

**`lib/share-payload.ts` is preparation for §19** — one `SharePayload` shape
for workout / PR / streak / challenge / program, built only from a post's
stored snapshot. `progress` is excluded: it is the one payload that may carry a
body weight the author typed in.

**Maturity: unverified against live data.** Typecheck, 586 vitest cases and 22
pgTAP suites pass; the signed-in pages have not been opened against the live
project.

### Reactions, photos on any post, the overlay and the story export (added 2026-09-28)

| | |
|---|---|
| Client | `/feed` (composer with photo, inline comment thread behind the icon, delete behind a confirmation in the "…" menu), `workout/[dayId]/done` (share panel: photo, figures/text on the photo, "Download for Story"), the "…" menu of an own post (story download) |
| Reads | unchanged RPC names; `social_feed()` / `social_post()` now carry `kudos_count`, `love_count`, `my_reaction`; `social_post_kudos()` carries `type` |
| Writes | `react(postId, pressed)` → `social_react()`; `createTextPost` / `createProgressPost` / `shareWorkout` take a `PostPhotoInput` (public_id, version, pixel size, overlay) in [app/social-actions.ts](../apps/web/app/social-actions.ts) |
| Maths | [packages/shared/src/social.ts](../packages/shared/src/social.ts) — `applyReaction`, `normalizePhotoOverlay`, `normalizePostPhoto`, `postPhotoOf`; [lib/photo-overlay.ts](../apps/web/lib/photo-overlay.ts) — the overlay's geometry; [lib/image-prepare.ts](../apps/web/lib/image-prepare.ts) — `photoFrame` |
| Migration | `20261002100000_reactions_and_post_photos.sql` (applied live 2026-09-28); `20261014100000_social_reactions_reconcile.sql` carries it through the Social 2.0 chain, whose migrations were written beside it (feed reads, reaction list, notification and guard redefined on the chain's latest bodies; a text or workout photo must be an upload in the author's own `voinic/posts/<id>/` folder) |
| Tables | `social_reactions.type in ('kudos','love')`, unique `(post_id, user_id)`; `social_posts_guard` keeps a text post's payload when it is a photo |
| Components | `reaction-icons.tsx` + `public/reactions/` (the arm and the peach, PNGs), `photo-overlay.tsx` (`PhotoFrame`, `PhotoOverlayEditor`), `lib/photo-story.ts` (the 1080×1920 canvas), the reactions row / `useReactions` / `DoubleTap` / `InlineComments` in `social.tsx`; `CommentComposer` is exported from `comment-thread.tsx` |
| Tests | `social.test.ts` (reactions, overlay, photo fields), `photo-overlay.test.ts`, `image-prepare.test.ts`, `supabase/tests/reactions.test.sql` (24 pgTAP) |

**One reaction per person.** The arm (`kudos`) and the peach (`love`) are two
values of one row: pressing the other one replaces it, pressing the same one
again takes it back. `social_react()` does the flip atomically as the caller,
so `reactions_insert` (`can_kudos_post`) still decides who may react. The card
keeps the state locally and moves it at once through `applyReaction`, which
mirrors the SQL; the action runs behind it, queued so quick presses land in
order, and its answer is what the card settles on. Neither the action nor the
card revalidates or refreshes the page: a reaction is one 200 ms write, and a
full feed re-render on every press is what made the button feel slow. A double-tap on a photo gives the arm and
never takes it back (Instagram's rule). The notification category stays
`new_kudos`; `payload.reaction` says which one arrived and picks the sentence.

**The icons are files, not emoji.** 💪 and 🍑 render differently on every
platform, so `public/reactions/` carries the pictures relu supplied, cut out
of their white background into transparent 256px PNGs. `reaction-icons.tsx`
shows them as `<img>`; the unpressed state is the same picture desaturated.

**Photos are shrunk on the device, not on Cloudinary.** `preparePhoto` decodes
through an `<img>` (EXIF-oriented), crops to at most 4:5 tall / 16:9 wide,
scales the long edge to 1600 and uploads a JPEG; the post stores `photo_w` /
`photo_h` so the card reserves the exact box. The signed-upload path is
unchanged.

**The overlay is fractions, not pixels.** Everything placed on a photo — the
workout's figures, one line of free text — is stored as a centre in 0..1 of
the photo's width and height, a `scale` multiplier (0.5–2; posts from before
the handle stored "s"/"m"/"l" and read as 0.82/1/1.24) and a `style`, and
every font on it is a fraction of the photo's width (`cqw` in the DOM,
`× width` on the canvas). So the 360px phone card, the 680px desktop card and
the story export show the same thing. `normalizePhotoOverlay` is the last
word on the server: clamped, known keys and styles only, text cleaned and
capped at 80; anything malformed is "no overlay", never an error. A workout
post from before overlays existed keeps its bottom gradient with the name and
headline numbers.

**The overlay behaves like Instagram stickers.** In the editor
(`PhotoOverlayEditor`, `useSticker`): drag moves an element; its gold corner
handle resizes it continuously; a tap on the figures cycles their style
(grid · row · column · hero) and a tap on the text opens it for editing in
place (`InlineTextEditor`, bound to the same state as the panel's field).
The text's style (plain · pill · gold) cycles from the ↻ button in the panel,
which also carries the figures' ↻ and S/M/L presets. After any change to an
element's box it is measured and pushed back inside the photo. The figures'
cells come from one pure function, `layoutStats(n, style, scale)` in
lib/photo-overlay.ts, which both `StatsBlock` (DOM) and `paintStats` (canvas)
draw from, so no style can look different in the story than on the card.

**A photo is a post.** A text or progress post needs words only when it has
no picture (`validatePostEdit(type, text, hasPhoto)`); with one, the caption
is optional and may be cleared on edit.

**Share to Instagram, Facebook…** is the native share sheet: there is no web
API that opens Instagram with a picture ready to post, and Facebook takes only
public links, so on a phone the story button hands the JPEG to the sheet
(where both apps are targets) and says so; a desktop gets a download and the
label says that instead (`useCanShareFiles`). The story is full-bleed: the
picture cover-fits 1080×1920 (centred crop), a scrim rises from the bottom,
and on it sit the workout's kicker, name and date with a row of its figures —
unless the author already placed the figures on the photo, which then stay
where they were put (and the name moves to the top if they reach the bottom
area). Everything the author placed is mapped through the crop and kept inside
the frame (`placeInFrame`); a text or progress post gets the picture, its text
and the mark only; the mark carries the tagline right under it, set like the logo's. Mocks of the alternatives (card on a brand gradient, card on
the photo's own colours) were rejected on 2026-09-28 in favour of this. The
canvas needs the Cloudinary copy (CORS), so it works once the upload has
finished — before or after the post goes out.

**Notifications read like a feed.** `NotificationRowView` (notification-list.tsx)
is one row for both the bell and `/notifications`: the actor's avatar with what
they did in the corner (the arm, the peach, a comment, a follow, a trophy), the
sentence with the name in bold ("relu19 zice că ești Peachy."), the comment's
words when there are any, when — and on the right the post it happened on
(its photo, or a tile for its kind). `getNotificationPage` fetches those posts
in the same wave as the actors. The page groups rows into today / this week /
earlier. Opening the bell marks everything read and clears the badge at once;
the rows that were new stay highlighted while the panel is open.

**Comments are one tap away.** The comment icon on a feed card opens the
thread under it (`CommentThread` in `embedded` mode: first page fetched on
open, box focused); a post reloads that page, never the feed. The post's own
page keeps the full thread as before.

### Social v2 completion: privacy, badges, achievements (added 2026-09-25)

| | |
|---|---|
| Client | `/people/[id]` (relationship chip, gated stats, Fitness Score snapshot, `#achievements`, public programs, achievements tab), `/people` (live search, paged; suggestions with a most-followed fallback), `/notifications` (all · unread, cursor-paged), privacy card on `/account` and `/settings`, share card on `/fitness-score` |
| Reads | `getProfileBadges`, `getMySocialPrivacy`, `getReplies`, paged `searchPeople` in [lib/social-data.ts](../apps/web/lib/social-data.ts); `getProfileRoutines` in `lib/routine-data.ts`; `getNotificationPage` in [lib/notifications-data.ts](../apps/web/lib/notifications-data.ts) |
| Writes | `editComment`, `loadReplies`, `shareAchievement`, `shareFitnessScore`, `publishFitnessScore`, `updateSocialPrivacy` in `app/social-actions.ts`; `loadNotifications` in `client-actions-app.ts`. Caption mentions are written by `insertPost` |
| Maths | [packages/shared/src/achievements.ts](../packages/shared/src/achievements.ts) — `earnedBadges`, `longestRun`, `fitnessScorePostPayload`, `canSeeStats`, `canSeeFitnessScore`, `followState`; [lib/notification-href.ts](../apps/web/lib/notification-href.ts) — routing, sentence, cursor |
| Migration | `20260930120000_social_v2_completion.sql` |
| Tables | `users.stats_visibility` / `fitness_score_visibility` / `fitness_score_public(_at)`, `social_comments.edited_at`, new `social_post_mentions`; post types `achievement`, `fitness_score`; notification category `badge_earned`; four badges added to the catalog |
| Components | `social-v2.tsx` (BadgeShelf, ShareFitnessScore, SocialPrivacyCard, PeopleSearchBox, MentionText, mention suggester), `social-skeleton.tsx` |
| Tests | `achievements.test.ts` (22), `notification-href.test.ts` (12), `supabase/tests/social_v2_completion.test.sql` (66 pgTAP) |

**Privacy lives in the RPCs, not the page.** `social_profile()` and
`social_streak()` are security definer and used to answer anyone with anyone's
workout / PR counts and streak. `can_see_stats()` (self · setting · active
coach · admin) now gates the numbers inside `social_profile`, `social_streak`
and `social_badges`; hidden numbers come back **null**, and the page says they
are private rather than showing zeros. Follow counts stay visible — the graph
is already public through `social_follow_list`.

**The Fitness Score on a profile is a snapshot.** It is computed in TypeScript
from private sets, so nobody else can compute it. The owner publishes it
(`set_public_fitness_score`, 0..100, own row only) and chooses who sees it
(`fitness_score_visibility`, private by default).

**Badges are awarded by the database.** `award_badges_for()` (not granted to
anyone) counts real rows — completed sessions, the longest workout streak, PR
sets, check-ins, finished challenges, consecutive food-log days — and inserts
into `user_badges`, which has no insert policy. Triggers on `logged_sessions`,
`check_ins`, `challenge_participants` and `food_logs` call it, swallowing any
failure so a badge can never roll back a workout. Existing history was
backfilled silently. `earnedBadges()` mirrors the thresholds.

**Snapshots are immutable.** The update grant on `social_posts` is now
column-level (`text`, `visibility`, `deleted_at`) and on `social_comments`
`body` only. `social_posts_guard` checks that `payload.kind` matches `type`,
refuses an achievement the author has not earned and rebuilds its payload
from the catalog, and bounds a Fitness Score post (0..100, a milestone from the
fixed list at or under the score).

### Media posts: up to ten pictures, private at rest (added 2026-09-28, applied live 2026-09-29)

| | |
|---|---|
| Client | the composer on `/feed` (Photo button, tray: preview, reorder, remove, retry, optional alt text, `n/10`); `components/media-gallery.tsx` draws the pictures on every surface (feed, profile, `/saved`, a share's original, the post page) |
| Delivery | `app/api/media/[token]/route.ts` — the only way a picture reaches a browser |
| Writes | `requestPostMediaUploads`, `discardPostMedia`, `createTextPost` / `createProgressPost` / `shareWorkout` (media list), `refreshPostMedia` in `app/social-actions.ts` → `social_create_post()` |
| Maths | `packages/shared/src/post-media.ts` (limits, file checks, list normalisation, frame ratio, carousel steps); `lib/media-draft.ts` (the composer's reducer); `lib/media-token.ts` |
| Migration | `20261016100000_social_post_media.sql` — `social_post_media`, `social_media_uploads` |
| Tests | `post-media.test.ts` (15), `media-draft.test.ts` (15), `media-token.test.ts` (8), `supabase/tests/social_post_media.test.sql` (59 pgTAP) |

**The browser never gets a Cloudinary URL for these.** New post pictures are
`authenticated` assets, and a signed Cloudinary URL never expires, so handing
one out would be a permanent key. Instead each page render mints
`/api/media/<token>` (HMAC, one picture, one of two sizes, 5–10 minutes) for
the rows the reader's RPC returned — `can_see_post` decides, so a blocked,
suspended, deleted or anonymous case gets no row and no link. The route
checks the token (and the middleware a session), fetches the picture
server-side and streams it with `Cache-Control: private`.

**Uploads are issued by the database.** `social_media_upload_register` mints
the public_ids (≤60/hour, active accounts), the server signs a Cloudinary
upload for exactly those (`type: authenticated`, `allowed_formats` jpg/png/webp
— Cloudinary checks content, not names), and `social_post_media_guard` only
attaches an id issued to the author, unused, to a fresh post of their own,
≤10. Before publishing, the server action asks Cloudinary what it stored
(format, bytes ≤8 MB, pixel size) and records Cloudinary's size.

**Abandoned uploads**: removing a picture or closing the composer discards
its uploads at once; anything left (a closed tab) is deleted from Cloudinary
the next time that person uploads (older than a day).

**Expired links refresh themselves.** A picture that fails to load (a link
older than its 5–10 minutes, typically a carousel swiped late) makes
`MediaGallery` call `refreshPostMedia(postId)` once per 30 s — the same
`social_post` RPC, so the same visibility rules — and swap the fresh links in.
The story download asks for a fresh link before painting the canvas.

**Workout posts use it too** (`20261017100000_workout_media.sql`, 2026-09-29,
applied live 2026-09-29; `supabase/tests/social_workout_media.test.sql`, 14
pgTAP). The share panel after a workout uploads through the same tray;
`social_create_post` takes `p_activity_id` for a workout post and the guard
lets media onto one. A single picture on a workout post keeps the overlay
with the workout's figures (`toMediaItems(…, allowStats)`), in the feed and in
the story. The old public path (`signPostPhotoUpload`, payload `photo_url`) is
gone for writes; posts made with it still show their payload photo, read by
`postPhotoOf`.

### Social privacy cleanup (added 2026-09-28, applied live 2026-09-29)

| | |
|---|---|
| Migrations | `20261015100000_social_privacy_cleanup.sql`, `20261015110000_social_mentions_cleanup.sql` |
| Tests | `supabase/tests/social_privacy_cleanup.test.sql` (82 pgTAP; 42 of them fail on the schema before it) |

**Suspension is enforced in the database, not only by the layout redirect.**
Every social write policy (post, comment, reaction, follow, save, story,
challenge, joining one) also asks `social_actor_active()` — not suspended, no
pending deletion — and `social_report()` does too. Deletes and block / unblock
stay open. `social_notify_ok()` refuses an inactive actor.

**The table endpoints follow the RPCs.** `comments_select`,
`reactions_select`, `post_mentions_select`, `comment_mentions_select` and the
owner branch of `story_views_select` apply the same "listed for the reader"
rule as the reads, so a direct PostgREST count agrees with `comment_count` /
`reply_count`. The author of a post or comment still reads every mention row
on it (the edit path diffs against them).

**A deleted post stays deleted.** `social_posts_delete_guard`: from a client,
`deleted_at` only goes from null to the server's `now()`.

**Challenges follow blocks and suspensions.** `can_see_challenge` hides a
challenge whose creator is behind a block (either way) and, while the creator
is suspended or being deleted, from anyone not already in it. Challenge boards
and coach progress name only listed people; ranks and the participant count
stay computed over everyone who joined. The global and following boards leave
suspended / deleting accounts out of the ranking.

**Reports**: one per reporter and target, whatever the reason (checked in
`social_report()` under an advisory lock; existing rows untouched). Hidden
comments and suspended / deleting users answer "not found", like missing ones.

**Mentions**: `social_mentions_cleanup()` (owner-only) deletes rows whose
handle is not in the current text; rows for suspended / blocked / deleting
people are kept and filtered on read. Idempotent.

### Advanced achievements (added 2026-09-27, applied to the live DB 2026-09-28)

| | |
|---|---|
| Client | `/achievements` (category filter via `?c=`, progress per badge), `/achievements/[slug]` (requirement, progress, earned date, how it's counted, share); profile `#achievements` gains rarity, per-category counts and a link for the owner; nav entry "Achievements" |
| Reads | `getMyAchievements` in [lib/achievements-data.ts](../apps/web/lib/achievements-data.ts) — one call to `achievement_progress()` |
| Maths | `ACHIEVEMENT_CATALOG`, `achievementProgress`, `isEligible`, `strengthFacts`, `summarizeAchievements`, `categoriesPresent` in `packages/shared/src/achievements.ts`; text in [lib/achievement-format.ts](../apps/web/lib/achievement-format.ts) |
| Migration | `20261002110000_advanced_achievements.sql` |
| Tests | `achievements.test.ts` (50), `achievement-format.test.ts` (8), `notification-href.test.ts` (16), `supabase/tests/advanced_achievements.test.sql` (60 pgTAP) |

**The catalog carries the rule.** `badges` gained `category`, `rarity`, `kind`
(standard | advanced — metadata, nothing gates on it), `metric`, `target`,
`active`. `award_badges_for(user, notify, metrics)` asks
`achievement_facts()` for the metrics of badges the person does not hold yet
and inserts every active badge whose `facts[metric] >= target`
(`award_badges_from_facts`). A new milestone is a catalog row. 34 badges: the
original 12 plus workouts 250/500/1000, volume 100k/500k/1M kg, active days
30/90/180/365, PRs 25/50/100, bench 100 / squat 140 / deadlift 180 kg (weight
lifted, library lift only), a 1,000 kg estimated-1RM total, food-logged days
30/100 and challenges 5/10/25.

**Triggers:** `logged_sessions` (all metrics), `check_ins` (`checkins`),
`challenge_participants` (`challenges`), and statement-level triggers on
`food_logs` and `habit_logs` that run once per insert statement and only while
a badge they could move is still missing. `achievement_progress()` (own rows
only, no user argument) also awards anything already satisfied before
answering — a backstop through the same idempotent path.

**Replies page.** A thread carries its first three replies and `reply_count`;
`social_comment_replies()` serves the rest on a cursor.

**Notification cursor is `created_at|id`**: one award run writes several rows
with the same `now()`, so `created_at` alone would skip one at a page boundary.

**The Fitness Score is the database's number when it leaves the owner's
screen** (`20260930130000_social_v2_cleanup.sql`). `fitness_score_of()` is
`fitnessScore()` composed over `training_load_score()` — the same formula,
pinned by `apps/web/lib/fitness-score-parity.test.ts` and
`supabase/tests/social_v2_cleanup.test.sql`, which score one fixture to the
same numbers. `set_public_fitness_score()` takes no argument, and
`social_posts_guard` replaces a `fitness_score` payload with the author's real
score, milestone and band, so a PostgREST call sending `100` publishes the real
number or nothing.

**Posts can be re-captioned** from the `…` menu on your own post (`editPost`):
only `text` changes (column grant), the database stamps `edited_at`, the card
says "edited", and caption mentions are re-resolved. Delete stays on the post's
own page. `validatePostEdit()` holds the rule: a text post keeps 1–500
characters, a data post may drop its caption.

### Routine library (added 2026-09-23)

| | |
|---|---|
| Client | `app/(client)/routines` (tabs: mine · discover · saved), `routines/[id]` (structure, actions, usage) |
| Coach | `(coach)/programs/[id]` keeps the structure editor and links to `/routines/[id]` for duplicate / assign / details |
| Reads | [lib/routine-data.ts](../apps/web/lib/routine-data.ts) — `getMyRoutines`, `getSavedRoutines`, `getDiscoverRoutines`, `getRoutineDetail`, `getRoutineUsage`, `getRoutineAssignees` |
| Writes | [app/routine-actions.ts](../apps/web/app/routine-actions.ts) — `copyRoutine`, `toggleRoutineSave`, `updateRoutineDetails`, `shareRoutine` |
| Maths | [packages/shared/src/routines.ts](../packages/shared/src/routines.ts) — `estimateMinutes`, `copyName`, `canSeeProgram`, `canCopyProgram`, `canChangeVisibility`, `snapshotProgram` |
| Migration | `20260923130000_program_library.sql` (was 20260923100000, which collided with `exercise_video_links` on main and on production) |
| Tables | `programs` + 6 columns, new `program_saves`. **No new program table** — a routine IS a program |
| Components | `routine-card.tsx`, `routine-filters.tsx`, `routine-actions-ui.tsx` |
| Tests | `routines.test.ts` (34), `supabase/tests/program_library.test.sql` (31 pgTAP) |

**Assigning is copying.** `programs.client_id` is NOT NULL and has always bound a
program to exactly one person, so there is no shared row to assign. One RPC —
`copy_program(source, name, for_client)` — is therefore behind all three
buttons: Duplicate, "Copy to my programs" and "Assign to a client". Copies are
independent all the way down (new program, days and prescribed exercises);
`source_program_id` records lineage only, and is `on delete set null` so
deleting an original never touches its children.

**A coach program can never be published.** The check constraint
`programs_shareable_only_solo` allows `visibility <> 'private'` only when
`coach_id is null`. A coach's program is written for one named client, so
publishing it would publish somebody's prescription. A coach who wants a public
template builds it from their own training account (`/routines`), where
`coach_id` is null — the same surface as **My training**.

**Reads are RPCs, not loops.** A card carries day and exercise counts, the
muscle groups across every exercise, the author and whether the reader saved it
— four round trips per card done naively. `program_card_rows()` does it in one,
and `my_programs()` / `discover_programs()` wrap it. Discover pages by offset
(two sort keys rule out one keyset shape) and fetches one row past the page to
answer "is there a next one" without a count query.

**Saving is a bookmark, not a copy.** `program_saves` has a unique
`(user_id, program_id)` and an owner-only policy whose *with-check* calls
`can_see_program` — which is what stops a private routine being bookmarked by
id. The toggle is optimistic because the constraint settles any race: a losing
second tap reports already-saved rather than an error. Same shape as follows
and kudos.

**Sharing is a snapshot.** `social_posts` gained the `program` type and a
partial unique index on `(user_id, payload->>'program_id')`. The payload comes
from `snapshotProgram()` and carries the plan — days, exercises, muscle groups,
estimate — and nothing anyone has logged. Editing the routine later never
rewrites the post, which is how every other post type in this app behaves.

**The editor was already there.** Reorder (days by `day_index` via
`move_program_day()`, exercises by `position`), duplicate day, rename day,
add/remove exercise and a targets form pre-filled from `DEFAULT_TARGETS` all
predate this work. The one thing missing was renaming the *program*, which
`updateRoutineDetails` now does alongside description, level, goal and
visibility.

**Maturity: unverified against live data.** Typecheck, 546 vitest cases and 20
pgTAP suites pass; the signed-in pages have not been opened against the live
project.

### Exercise analytics & previous workout (added 2026-09-22)

| | |
|---|---|
| Client | `app/(client)/exercises/[id]` (one lift: header, bests, three charts, session history); the "Previous" block inside `workout/[dayId]/log` |
| Reads | `getPreviousForDay` / `getExerciseHistory` / `getExerciseProfile` in [lib/exercise-analytics-data.ts](../apps/web/lib/exercise-analytics-data.ts); row mapping in `lib/exercise-analytics-map.ts` |
| Maths | [packages/shared/src/exercise-analytics.ts](../packages/shared/src/exercise-analytics.ts) — `previousWorkouts`, `prefillFor`, `exerciseSessions`, `exerciseStats`, `metricSeries`, `progressionVs`, `relevantOneRm`, `exerciseSnapshot` |
| Tables | `logged_sets` joined to `logged_sessions` — **no new table, no new column, no RPC, no migration** |
| Components | `exercise-analytics.tsx` (page), `previous-sets.tsx` (`PreviousSets` + `ProgressionNote`) |
| Tests | `exercise-analytics.test.ts` (50), `exercise-analytics-map.test.ts` (6), `supabase/tests/exercise_history.test.sql` (6 pgTAP) |

The logger shows every set of the last **completed** session on each lift,
right above the boxes, and pre-fills each box from the *same set number* of
that session (`prefillFor`) — so a descending block offers 105 for set 2 rather
than 110 again. After a set lands, one factual line compares it with that same
set number: `↑ +2.5 kg vs previous`, never a verdict. `/exercises/[id]` is the
long view: last performance, best weight / reps / volume / estimated 1RM,
session and set counts, lifetime volume, three progressions (top weight, volume,
estimated 1RM) over 7 / 30 / 90 / 365 days / all time, and every completed
session set by set.

Two rules the module exists to enforce: an **abandoned session is never
"previous"** (the read inner-joins `logged_sessions` on `completed_at not null`,
and `toAnalyticsSets` repeats the check because an embedded PostgREST filter is
one parameter away from silently not applying), and **weights are never rounded
in transit** — 21.25 kg stays 21.25 kg, and the display does the rounding.

1RM is the existing Epley in `prs.ts`. That file gained `estimated1RMExact`
(unrounded, for sorting and charting); `estimated1RM` still rounds to one
decimal and is still what PR detection compares, unchanged. Analytics uses
`relevantOneRm`, which returns **null above 12 reps** where Epley stops
describing a one-rep max — PR detection keeps its own unbounded rule, because
narrowing it would silently rewrite `is_pr` on rows already stored.

Reads are one query each, index-covered by `logged_sets_history_idx
(user_id, exercise_id, received_at desc)`, which had no reader until now.
Privacy is policy `sets_owner`, not app code: the queries filter by exercise,
never by user, so `supabase/tests/exercise_history.test.sql` is what proves one
person cannot read another's history by typing an id into the address bar.

**Maturity: unverified against live data.** Typecheck, 512 vitest cases and 18
pgTAP suites pass; the signed-in pages have not been opened against the live
project (no session on this box).

**Merged with main's exercise page (2026-09-23).** Both branches built
`/exercises/[id]`; the merge keeps one page on one domain module. From main:
rep records (`repRecords`, moved into `exercise-analytics.ts` with main's tests),
the bodyweight variant (`stats.bodyweight`, a `reps` chart), the demo video and
how-to (`ExerciseVideo`, links resolved in `getExerciseProfile`), and the plan
gates — charts and rep records are `progressCharts`, the history list follows
`historyDays` (`UpgradeHint` passed in as slots; the component never reads the
plan). Main's parallel `exercise-history.ts`, `exercise-history-data.ts` and
`exercise-trend-chart.tsx` were removed rather than kept beside it. The page's
estimated 1RM stays `relevantOneRm` (≤ 12 reps); PR detection keeps its own
unbounded `estimated1RM`. Entry points: the "Open history" chip in the library
list, the "My history" button in the exercise preview, the PR list on Progress
and exercise names in a day's history.

### Rest timer (added 2026-09-19)

| | |
|---|---|
| Client | The sticky bar under every `(client)` route (`components/rest-timer-bar.tsx`), the per-exercise rest chip in `set-logger.tsx`, the **Rest timer** card on `/account` and `/settings` (`components/rest-settings.tsx`) |
| Writes | [app/rest-actions.ts](../apps/web/app/rest-actions.ts): `saveRestPrefs`, `savePushSubscription` / `removePushSubscription`, `scheduleRestPush` / `cancelRestPush` |
| Math | [packages/shared/src/rest-timer.ts](../packages/shared/src/rest-timer.ts) — `startRest` / `pauseRest` / `resumeRest` / `extendRest` / `skipRest` / `settleRest`, `remainingMs`, `markRestNotified`, `plannedSets` / `nextPlannedSet` / `restBetween`, `resolveRestSeconds`, `restAfterLoggedSet` |
| State | `lib/rest-timer/client.tsx` (`RestTimerProvider`, mounted in `(client)/layout.tsx`), persisted in `localStorage` under `voinic-rest-timer-v1` (`lib/rest-timer/storage.ts`) |
| Tables | `users.rest_prefs` (jsonb: default, per-lift overrides, notify), `push_subscriptions`, `rest_pushes` — migration `20260919100000_rest_timer.sql`, pgTAP `rest_timer.test.sql` |
| Push | `apps/web/app/sw.ts` (push + notificationclick; served as `/serwist/sw.js`, see the Offline row of GAPS), `app/manifest.ts`, edge function `rest-push` (Web Push via `jsr:@negrel/webpush`), pg_cron `rest-push-tick` every 10 s → `tick_rest_pushes()` → `net.http_post` |

After `logSet()` succeeds — and only then — `restAfterLoggedSet()` decides
whether a rest starts: not after the workout's final set, not on a completed
day, and not between the members of one superset round (the rest comes after
the round). Duration: the person's override for the lift → the coach's
`program_exercises.rest_seconds` → the person's default (60 s; presets 30/45/
60/90/120/180 or custom 5–600). The timer is two epoch instants, `startedAt`
and `endsAt`; the UI ticks every 250 ms only to re-read `Date.now()`, and
`visibilitychange` re-settles it, so a phone that was locked shows the right
remainder the moment it wakes. Pause freezes the remainder; resume recomputes
`endsAt`; +15 s moves it; Skip ends it.

Completion is announced once per timer id (`notifiedAt`): an in-app banner
when the page is visible; a notification through the service worker when the
tab is hidden but alive; and, when the device is asleep, the server push —
scheduled as one `rest_pushes` row keyed by the timer id, claimed atomically
by `claim_due_rest_pushes()` before sending. No sound, no vibration anywhere
(`silent: true`, no `vibrate`); the OS and the person's settings have the
last word on that.

**Maturity: timer solid, push pipeline live.** The timer, settings and
permission flow were driven in the browser on 2026-09-19, and the same day the
server side was set up on the production project and exercised end-to-end
(due row → cron tick → `net.http_post` → function `200 {"due":1,…}` → row
marked sent): VAPID keys from `node scripts/vapid-keys.mjs`, function secrets
`VAPID_KEYS_JSON` / `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on Vercel,
`supabase functions deploy rest-push`, vault secrets `rest_push_url` /
`rest_push_key`. A new environment needs that list again. The function does
not compare the bearer against `SUPABASE_SERVICE_ROLE_KEY` (the injected
value no longer equals the legacy JWT once a project carries `sb_secret_`
keys); it uses the caller's bearer as its client key and lets the grant on
`claim_due_rest_pushes()` decide. What has *not* been observed yet is a real
device receiving one — the desktop app's browser pane denies notifications by
policy. Delivery latency is up to one tick (10 s).
2026-09-25: an iPhone never got one while locked. Apple had been rejecting every push with
`400 BadWebPushTopic`, because the `Topic` was `rest-<32 hex>` and RFC 8030 caps a topic at 32
characters. The topic is now the bare uuid hex, and a test push to the live Apple endpoint
returned `sent: 1`. Failures now come back in the function's `errors` array, which is kept in
`net._http_response`. iOS delivers Web Push only
to a Home-Screen-installed app, which is why the manifest exists.

---

## Nutrition

| | |
|---|---|
| Coach | `app/(coach)/nutrition`, `nutrition/new`, `nutrition/[id]` |
| Client | `app/(client)/food` |
| Writes | [app/nutrition-actions.ts](../apps/web/app/nutrition-actions.ts) (coach side), `logFood` / `updateFoodLog` / `deleteFoodLog` / `toggleFavoriteFood` (client side) |
| Reads | `getNutritionPlans` / `getNutritionPlan`, `getMyDayNutrition` / `getMyPlanMeals` / `getMyFoodDays` / `getMyQuickFoods` (recent + starred, for the logger) |
| Tables | `foods`, `nutrition_plans → planned_meals → planned_meal_foods`, `food_logs`, `food_favorites` |
| Components | `nutrition-builder.tsx`, `new-plan-form.tsx`; client diary: `week-strip.tsx`, `nutrition-summary.tsx`, `meal-card.tsx`, `food-logger.tsx`, `food-entry.tsx`, `barcode-scanner.tsx` |
| Edge functions | `food-search`, `barcode-lookup` (+ `_shared/portions.ts`) |

**How a plan actually works.** The coach picks a client, names the plan, and sets
four daily targets (kcal, protein, carbs, fat). Creating the plan auto-inserts
four meal slots — breakfast, lunch, dinner, snack. The coach then fills each slot
with **real foods and gram amounts** searched out of the `foods` table; macros are
computed per-100g × grams and live plan totals sit next to the targets so the day
can be made to land on the number. Publish makes it visible to the client, who
sees it under each slot as "coach planned" next to their own log.

So it is **ingredient-based, not calories-only** — but see [GAPS.md](GAPS.md):
there is no per-weekday plan, no recipes, and no one-tap "ate as planned".

**Where food data comes from.** `foods` is a local cache. Custom foods are
owner-scoped; Open Food Facts rows are written by the edge functions on first use,
so the cache grows organically and the second person to scan a product pays
nothing. The generic list is the USDA SR Legacy import (`seed/usda-foods.sql`,
6781 rows, now with saturated fat / sugar / salt — migration `20261019100000`),
English by birth; `seed/dishfinder-names.sql` gives ~420 of them the Romanian
name DishFinder already had and a `dishfinder_ingredient_id`
([DISHFINDER.md](DISHFINDER.md)). Search ranks Romanian-named rows first and the
pickers fold the rest of the USDA tail under "more results in English".
**`foods` is not listable** (migration `20261019120000`): a user reads only the
rows their plans, logs, favourites and customs reference; everything else goes
through `search_foods()` (2+ chars, ≤ 60 rows, 400/user/day), `food_by_id()` and
`food_by_barcode()` — `searchFoods` / `lookupBarcode` in `nutrition-actions.ts`
call them, never the table. Two rules the schema enforces and that are easy to
break by accident:

- `food_logs` **snapshots** name and macros at log time. External nutrition data
  changes; a client's history must not.
- `foods.portions` is a jsonb serving list (`[{label,grams,note,origin}]`) with a
  check constraint on its shape, and a `preserve_food_portions` trigger so a
  re-import can never wipe a curated range or overwrite a good value with an
  empty one. Grams are always **edible weight** (eggs are stored shell-off).

**Maturity: unproven** on the coach side (`nutrition-actions.ts`); the client
logging path is the most developed part of the app.

---

## Progress

| | |
|---|---|
| Client | `app/(client)/progress`, `app/(client)/check-in` |
| Coach | `app/(coach)/check-ins` |
| Writes | `addMeasurement`, `submitCheckIn` (client-actions-app.ts); `reviewCheckIn` ([actions.ts](../apps/web/app/actions.ts)) |
| Reads | `getMyMeasurements`, `getMyCheckInState`, `getMyPrs`; `getCheckIns` |
| Tables | `measurements`, `check_ins`, `progress_photos`, `adherence_snapshots` |
| Components | `measurement-form.tsx`, `check-in-form.tsx`, `check-in-review.tsx` |

Adherence is scored in `packages/shared/src/adherence.ts` — the versioned formula
from PRODUCT_SPEC §7 (`0.40·workout + 0.30·nutrition + 0.15·habits +
0.15·checkin`) that produces the on-track / needs-attention / at-risk signal on
the coach dashboard. **This formula must never be duplicated in a component.**

The inputs are assembled in one place, `apps/web/lib/live-adherence.ts`
(`foldActivity` + `adherenceOf`): the client's Today and the coach's dashboard,
roster badge and client page all show **this week, computed live** from the
rows (the coach side batched per 10 clients, one wave). `adherence_snapshots`
(written weekly by `compute_adherence_snapshots()` for the *previous* week) is
only the fallback when those live reads fail — reading it as "now" is what made
the dashboard say "no logs for 13 days" about a client who trained that morning
(BUG-17). On Today, `atRiskCause()` separates a stalled week from an active one
with a low % so the nudge says the true reason (BUG-10).

---

## Coaching

`app/(coach)/messages`, `messages/[id]`, `app/(client)/coach`. `sendMessage` in
actions.ts; `getConversations` / `getMessages` / `getMyCoachThread`. Tables
`conversations`, `messages`, `coach_feedback`. Component `message-thread.tsx`.
Plain threaded messaging — no realtime subscription yet, reads are server-rendered.

**Who may write** (migration `20261104100000_request_conversations.sql`): one
conversation per (coach, client), and `msg_insert` asks `conversation_open()` —
both accounts live (not suspended, no deletion pending), no block either way,
and an active relationship **or** an accepted contact request not yet started.
A blocked, ended or no-longer-accepted pair keeps its history readable and takes
no new message (`sendMessage` → `CONVERSATION_CLOSED`, the thread shows it closed).
**Where a request's thread comes from**: "Message coach" (`/coaches/requests`, the
public profile) and "Message client" (`/requests`) call `open_request_conversation()`,
which returns the pair's existing conversation or creates an empty one — on click,
nothing sent, the request untouched. `start_coaching_from_request()` reuses it.
The client reads any thread at `/coach/messages/[id]`; `/coach` stays the active
coach's thread (`getMyCoachThread` is scoped to that coach). The coach's inbox is
`coach_conversations()` (the users policy hides a request-only client) and a thread's
header `conversation_context()` (who, open or not, the request it came from).
**Notice and read state**: a trigger writes `new_message` — one unread per
conversation, no message text, `payload.screen` coach_thread / client_thread — and
`mark_conversation_read()` (called by the thread once shown) stamps `read_at` and
reads that notice. `UPDATE` on messages is granted on `read_at` only.

---

## Bookings

Migration `20261105100000_coach_bookings.sql`; pgTAP `coach_bookings` (100), race
test `npm run db:test:race` (`scripts/pgtest/race-bookings.mjs`: two connections,
one slot). Rules shared with SQL in `packages/shared/src/booking.ts`.

**Time zone.** The coach's `users.timezone` (IANA; validated against
`pg_timezone_names` in SQL by `booking_timezone_valid()`). Weekly hours and time
off are wall-clock times in it, turned into instants only when slots are
computed, so 09:00 stays 09:00 across DST. A booking stores absolute
`start_at`/`end_at` plus the zone it was made in and is always shown in that
zone, labelled.

**Model.** `coach_services` gains booking settings (bookable, duration, buffers,
min notice, max advance, access public | clients, confirmation instant |
approval), set only through `coach_set_service_booking()` — operational like
active/order, allowed on any non-suspended profile; a `digital` service is never
bookable. `coach_availability` (ISO weekday, start, end, active; an exclusion
constraint on a `time_range` refuses overlapping active blocks) and
`coach_availability_exceptions` (a date range all day, or one date between two
times) are owner-only tables written directly by `app/booking-actions.ts`.
`bookings` has no write policy: `book_service`, `respond_booking`,
`cancel_booking`, `mark_booking` are the only moves; it snapshots the service's
name and price (informational — nothing is charged).

**Slots** are never stored: `booking_slots_internal()` = weekly blocks − time off
− pending/confirmed bookings (buffers included, and the coach's own bookings as
somebody's client) − notice − advance, one set-based query, 30-minute steps
(15 under 30-minute sessions). `coach_booking_slots()` is the public door (anon
included) and returns only start/end; `book_service()` re-runs it for the one
start it is given.

**Double booking.** Two exclusion constraints over pending + confirmed rows —
the coach's buffered time, the client's own time — plus per-person advisory
locks in `book_service()`. A pending booking holds its slot until answered.

**Notices / reminders.** Category `booking`, payload.event requested / booked /
confirmed / declined / cancelled / reminder, through `social_notify_ok`.
`detect_booking_reminders()` runs every 15 minutes on the existing pg_cron and
reminds both sides once, about a day ahead.

**Screens.** Coach: `/bookings` (tabs) and `/bookings/availability` (week, time
off, bookable services). Client: `/coaches/bookings`; booking at
`/coaches/[slug]/book?service=…` (anyone can look; confirming needs a sign-in);
"Book" on the public page's service cards (`coach_booking_services(slug)`, which
degrades to "no Book buttons" while the function is missing on a database).
A booking never creates a conversation; the rows link the pair's existing one.

## Reviews

Migration `20261106100000_coach_reviews.sql`; pgTAP `coach_reviews` (84).

**Eligibility** (`coach_review_eligibility()`): coaching with the coach that is
active and started 7+ days ago, or that ended; else a `completed` booking. A
request, a conversation, a cancelled or no-show booking is not enough.
**One review per reviewer and coach** (unique), edited in place; no payment.

**Writes are RPCs only** (`coach_reviews` has no write grant): `submit_coach_review`
(create / edit / revive after a delete), `delete_my_coach_review` (soft: status
`deleted`, text and answer cleared), `respond_to_coach_review` (the coach's one
answer — a field on the review, not a comment system), `admin_set_review_status`
(published ↔ hidden, reason required, audited, closes the review's reports). A
trigger refuses any change to reviewer_id / coach_id. A hidden review is neither
editable nor deletable by its author.

**Aggregates** `coach_profiles.review_count / review_avg / review_distribution`
are recomputed from published reviews by a trigger — derived, not grantable to
the coach. `search_coaches()` reads them as columns and returns `rating` on each
card (not used in the order); `coach_public_reviews(slug)` serves the public
section (anon included; reviewers suspended, deleting or behind a block with the
reader are left out of the list).

**Reports** reuse `social_reports` / `social_report('review', …)` and the existing
report sheet (`ModerationMenuButton place="review"`). **Notices**: category
`review` — `published` to the coach, `response` to the reviewer.

**Screens.** Public page Reviews section (`#reviews`) + `/coaches/[slug]/review`
(write / edit / delete); "Review coach" on a completed booking; the coach's
`/reviews` (answer, report); admin: reported reviews on `/admin/coaches`, a
coach's reviews on `/admin/coaches/[id]`.

## Public directory & SEO

Migration `20261107100000_coach_public_seo.sql`; pgTAP `coach_public_seo` (32);
`lib/seo.ts` + `lib/coach-public.ts` (unit-tested); e2e `public-directory.spec.ts`.

**Indexable** = published (pre-moderated, complete per `coach_profile_missing()`)
and still carrying a headline, an about, an avatar, a specialization and a
service — `coachIndexable()` on the page (else `noindex, follow`),
`coach_sitemap()` in SQL. Everything else is a real 404 (no `loading.tsx` under
`/coaches/[slug]`).

**Crawlers**: `app/robots.ts` (app routes disallowed; `/coach/` and `/coach$`, never a
bare `/coach`, which would also match `/coaches`) and `app/sitemap.ts` (dynamic,
falls back to the two static pages). Both are in middleware's public list —
before, a signed-out crawler was redirected to /login. `metadataBase` is `SITE_URL`.

**Permanent links**: `coach_slug_redirects` keeps every published slug a profile
had; the page 308s an old slug (or another spelling) to the canonical one; an
old slug cannot be taken by another coach (SLUG_TAKEN).

**Anonymous vs signed in**: the same URL. Anonymous readers get
`coachTeaser()` (about cut at 280 chars, 3 services, 3 reviews, 3 programs — cut
on the server) and `PublicProfileGate` ("See the full profile": sign up / sign in
with `next=/coaches/<slug>`, `/login?mode=signup`). A Google account without a
username is sent through `/complete-profile?next=` and back.

**Structured data**: `coachPageJsonLd()` — ProfilePage → Person (+ alternateName,
dateCreated, follower count) and a BreadcrumbList. No `aggregateRating`: Google
does not support review snippets for a Person, and an online coach is not a
LocalBusiness; the rating is shown on the page (header and Reviews).

## Coach marketplace (operations)

Migration `20261108100000_coach_marketplace_ops.sql`; pgTAP `coach_marketplace_ops` (55);
`lib/coach-revision.ts`, `lib/coach-completeness.ts` (unit-tested); e2e `marketplace.spec.ts`.

**Staged revisions** (decided 2026-10-07): a published / hidden profile is edited as
a copy (`coach_profile_revisions`, one per profile, jsonb in the editor's shape); the
public page never changes until an admin approves (`admin_decide_coach_revision`,
audited). The wizard is the same component: every content action in
`coach-profile-actions.ts` checks `openRevision()` and patches the copy instead.
Each save is judged by the real tables — `coach_revision_check()` applies the copy
in a savepoint, runs `coach_profile_missing()` and rolls back. Not in a revision:
slug, cover, and the operational switches (accepting, hide/show, booking settings).
The three set RPCs are now wrappers over `coach_apply_*(profile, …)`. Removed
services a booking or request points at are switched off, not deleted.

**Marketplace** `/marketplace` (one sidebar entry, `navItemActive()` also lights it on
/requests, /bookings, /reviews, /settings/coach-profile; `MarketplaceTabs` over those
pages): `coach_marketplace_overview()` in one round trip + the editor's own read for
`profileCompleteness()` (11 weighted items, the 6 required = publishing's). No
profile-view analytics exist, so none are shown. /requests gained Coaching and
Cancelled tabs; /clients a next-session column (one bookings query).

**Funnel**: signed-out Contact / Save carry `?intent=contact|save` through sign-in;
the coach page completes it once in the browser (dialog opened / saved) and drops
the parameter. Starting coaching now notifies the client (coaching_request,
event `started`).

## Coaching lifecycle

Migrations `20261109100000_coaching_lifecycle_states.sql` (enum values, alone because
Postgres will not use a new enum value in the transaction that added it) and
`20261109110000_coaching_lifecycle.sql`; pgTAP `coaching_lifecycle` (61);
`packages/shared/src/coaching-lifecycle.ts`; e2e `coaching-lifecycle.spec.ts`.

The relationship is `trainer_clients`: invited → active → (paused ⇄ active) → ended,
ended final. `trainer_clients_lifecycle_guard` enforces the graph and frozen
identities for every writer; `coaching_transition(id, to, reason)` is the only
participant write (direct insert/update grants and policies were dropped — they
let a coach rewrite client_id or reactivate rows). One *current* coach per client:
`one_current_coach_per_client` covers active + paused. Every status change becomes
a `coaching_relationship_events` row (from, to, actor, general reason code) via
trigger; the admin audit logs pause/resume. Reasons are fixed codes, never text.

Effects: paused keeps messages open and bookings untouched, pauses the coach's
data access (is_active_coach_of stays active-only) and clients-only booking;
ended makes the thread read-only and keeps everything; review eligibility counts
paused like active. A new engagement is a new row (request → start). Reads:
`my_coaching_relationships()`, `coach_client_relationships(scope)`,
`coaching_relationship_history(id)`, and `coach_viewer_state().relationship` — the
CTA's one source (states client / paused / start_new). Screens: the client's
/coach (current coach + past coaches), the coach's /clients (Paused and Past
sections) and /clients/relationship/[id]. Notices: category `coaching`.

## Marketplace trust, ranking & analytics

Migrations `20261110100000_marketplace_trust_states.sql` (the `marketplace` notification
category, alone), `20261110110000_marketplace_trust.sql`, `20261110120000_marketplace_analytics.sql`,
`20261110130000_coach_ranking.sql`; pgTAP `marketplace_trust` (69), `marketplace_analytics` (55),
`coach_ranking` (40); `packages/shared/src/marketplace.ts` (+ `moderation.ts`); e2e
`marketplace-trust.spec.ts`.

**Trust.** Nothing new to report through: a coach profile is the fifth target of the one
`social_report()` path (`reported_coach_profile_id`, reason `fake_credentials` for coach
reports only; the coach menu offers inappropriate / misleading / impersonation / fake
credentials / harassment / spam / other). Reports gained `resolved_at`, `resolved_by`,
`resolution_note`; status stays open / reviewed (= resolved) / dismissed. Still unreadable
from the app. Admin: `/admin/reports` (`admin_reports`, `admin_report_counts`,
`admin_resolve_report` — closes every open report of the same target), and on
`/admin/coaches/[id]` the coach's reports. Suspend / unpublish, verification and review
hiding were already there; they now close the target's open reports and tell the coach
(`marketplace_notify`, category `marketplace`, fixed sentences, no moderator, no reporter).
Every public door already required `status = 'published'` and a live account, so a
suspended coach leaves /coaches, every city / specialization listing, search, the sitemap
and the public page at once; relationships, bookings, messages and reviews stay.

**Ranking.** One layer, `coach_ranked(...)` (internal: no grant to anon/authenticated),
behind `search_coaches()` (same signature and cards) and `admin_coach_ranking()`. The query
is read as structure first (`coach_query_tokens`: stop words, online / in person / hybrid,
a specialization or a city from the catalogs, else text), each word scored per coach
(`coach_token_score`) and every word must be answered. A city word also lists online
coaches (after the local ones); a two-word query is never carried by one word.
`score = 0.5·relevance + 0.5·base + cold_start` with context, `base + cold_start` without;
`base = 0.30 trust + 0.30 quality + 0.15 responsiveness + 0.15 activity + 0.10 engagement`;
Bayesian rating (5 virtual 3.5★ reviews); cold start ≤ 0.06 fading over 45 days for a
qualified new profile; `placement` always 0 (the slot for sponsored, later, separate).
Slow counts live in `coach_rank_signals`, refreshed every 15 minutes by pg_cron
(`coach-rank-signals`); the formula is mirrored in `packages/shared/src/marketplace.ts`.
Admin inspector: `/admin/marketplace` and the coach page's Ranking section.

**Analytics.** `marketplace_events`, first-party, no user id: the browser calls
`marketplace_track()` (closed list: directory_view, profile_view, cta_contact, cta_book,
cta_save, cta_full_profile, signup_started); the visitor is sha256(daily salt | IP | agent)
computed in the database from PostgREST's request headers, never stored, salt deleted the
next day; one per visitor/event/target/day, 60 per visitor per hour, no bots, not your own
page. Conversions (request sent / accepted, coaching started, booking created / completed,
review submitted, coach saved) are triggers on the business tables, deduped by row, never
able to fail the write. Sign-up attribution: the form sends `signup_ref` (coach from `next`,
utm_* carried in the login links by the coach page) → `on_auth_user_created_marketplace` →
`marketplace_signups`. Retention (`marketplace-retention` cron): views/clicks 180 days,
conversions and signups 2 years, salts 1 day. Coach: `/marketplace` Performance card
(`coach_marketplace_analytics`). Admin: `/admin/marketplace` (`admin_marketplace_analytics`)
— counts and trends, no conversion rates. Client side: `components/marketplace-tracker.tsx`
(one view per mount + any click on `[data-mkt]`); nothing on the device.

## Discovery 2.0, profile content & landing pages

Migrations `20261111100000_coach_profile_content.sql`, `20261111110000_coach_discovery_v2.sql`,
`20261111120000_marketplace_analytics_v2.sql`; pgTAP `coach_discovery_v2` (60), `marketplace_analytics_v2` (22);
`lib/coach-discovery.ts`, `lib/coach-content.ts`, `lib/coach-public.ts`, `lib/seo.ts` (unit-tested); e2e
`marketplace-discovery.spec.ts`.

**Still one ranking layer.** `coach_ranked()` is redefined, its formula and weights untouched. What changed:
a free-text word now scores by *where* it matched — the profile's text is kept as a weighted tsvector
(`search_wdoc`, built by the same trigger as `search_text`): A public name / username 1.0, B headline +
specializations + city / country / gym 0.85, C service names + descriptions 0.7, D about + approach +
experience 0.5, a near miss 0.4. Catalog words (specialization, city, format) keep their structured scores.
An exact public name or username (`@` and case ignored) is a navigational tier: first under Recommended and
Most relevant, never forced in a pure sort. Sorts: `relevance` is now the match alone, `rating` the Bayesian
rating the quality part already uses, `availability` the soonest free public slot. Filters: service kind,
language (any of), minimum rating (3 / 3.5 / 4 / 4.5, published reviews), available (a free public slot in 14
days — `coach_rank_signals.next_available_at`, refreshed every 15 minutes from `booking_slots_internal()`).
Cards gain `available_soon` (a fact, never the timestamp); `coach_discovery_facets()` gains `languages`,
`service_kinds` and a coach count per specialization. `search_coaches()` and `coach_ranked()` were dropped and
recreated (new arguments): the app sends the new ones only when set.

**URL and UI.** Every filter and sort is in the URL (`?service=&language=&rating=&available=&sort=`); refresh,
share and back / forward work. Desktop: the sidebar runs each change, shows the active count and Reset. Phone:
the sheet edits a *draft* — nothing runs until Apply, Reset clears the draft, Cancel forgets it. One
`DiscoveryListing` (`components/coach-discovery/listing.tsx`) for /coaches and the landing pages, with empty
states that say why: no coaches in a place (offer online / anywhere), none for a specialization, too many
filters (5+, offer Clear filters), nothing for these filters / this text.

**Landing pages.** `/coaches/<city | specialization | country>` (the slugs share the coach namespace, reserved
since 20261020100000): the same listing at an address of its own, an H1 and intro, canonical to itself,
`CollectionPage` + breadcrumb JSON-LD, indexable only while it lists someone, and in the sitemap (`landingSlugs`).
Cities and countries resolve only while they have a published coach (else 404); every active specialization
resolves. Every `/coaches?…` combination stays `noindex, follow`. The Discovery Home's city and specialty links
point at the landing pages (`listingHref`).

**Profile content.** `coach_profiles` gains `approach`, `experience_summary`, `client_goals` (closed codes, ≤ 6)
and `social_links` (handles for instagram / tiktok / youtube / facebook / linkedin and one https website —
`coach_social_links_valid()`; the app builds every URL, `lib/coach-content.ts`). Content like the rest: editable
directly only in draft (edit lock), through the staged revision otherwise (snapshot / apply carry them; an old
copy without a key keeps the live value), in the search text at weight D. `coach_public_profile()` and
`admin_coach_review()` are layered: the previous bodies are `*_base` (internal), the public names return base ||
`coach_profile_content()` (+ `availability`: bookable, next free public slot in 14 days, the coach's zone).
The page labels approach / experience "in the coach's own words — not checked by Voinic"; credentials and the
badge stay Voinic's word. Editor: `ClaimNudge` warns on guarantees, set weight loss in a set time, medical
claims (`hasRiskyClaim`), and the admin revision review flags them — a nudge, pre-moderation decides.

**Page order**: header (rating, place, format, next free slot, Follow / Save / Share / Contact) → About →
Specializations + Works with → Coaching approach + Experience → Services → (gate) → Credentials & verification →
Availability → Reviews → facts → Programs → Posts → Why train with. Share uses the native sheet or copies the
canonical URL. Metadata: `coachPageMetadata()` (canonical, robots, OG `profile` with `alternateLocale`, Twitter;
images re-cut by `socialImage()` to 1200×630 / 600×600 JPEG), JSON-LD gains `sameAs`.

**Intent through sign-in**: Contact / Save as before (`?intent=`); Book keeps the chosen time (`?at=`, only ever
pre-selected). **Completeness** gains "a public price" (5) and "coaching approach" (5); 13 items, still 100.

**Analytics** (same log, same rules): `search` (never the text), `filter_applied` (detail = the filter's name),
`service_view` (a booking page), `share` (native | copy), `login_required` (contact / book / save / follow /
review / message / full_profile — `data-mkt-wall` on the anonymous CTAs). The coach's card counts booking pages,
shares and sign-in walls; the admin's funnel has the new steps, the filters used and the walls hit.

## Calendars (foundation)

Migration `20261111130000_calendar_integrations.sql`; pgTAP `calendar_integrations` (44);
`packages/shared/src/calendar.ts`, `lib/calendar/{token-crypto,provider,sync}.ts` (unit-tested);
`lib/calendar-data.ts`, `app/calendar-actions.ts`, `components/calendar-integrations.tsx`.

**What exists**: the data model and its security boundary, the slot integration, the provider-agnostic
contract and sync logic, the coach's status card. **What does not**: any provider adapter, the OAuth callback,
the worker. So no coach can connect yet; the card says "coming soon" and booking behaves as before.

- `calendar_connections` (one live per coach and provider; status pending / connected / syncing / error /
  reauth_required / disconnected; account label, last sync, a fixed error code) — owner reads the status columns.
- `calendar_credentials` — tokens as AES-256-GCM ciphertext bound to the connection id
  (`lib/calendar/token-crypto.ts`, key `CALENDAR_TOKEN_KEY` outside the database, versioned) + the provider's
  opaque sync state. **No grant, no policy**: service_role only, not even the owner.
- `calendar_sources` — the calendars (name, primary) and `affects_availability` (the coach's switch; a new
  primary calendar on, the rest opt-in). Owner-readable.
- `calendar_busy_blocks` — `tstzrange` intervals only, only for calendars that affect availability. No grant.

Coach RPCs: `my_calendar_integrations()`, `calendar_set_source_availability()` (off drops the busy time at once,
on asks for a sync), `calendar_disconnect()` (calendars and busy time deleted at once; the token waits for the
worker to revoke it, purged after 7 days by `calendar-credentials-purge`). Server RPCs (service_role only):
`calendar_connection_open()`, `calendar_connections_due()` (marks them syncing, `skip locked`),
`calendar_sync_apply()` (atomic replace of the window), `calendar_sync_failed()` (refused credentials →
reauth_required, no retry; anything else → error, retried), `calendar_credentials_revoked()`.

**Slots**: `booking_slots_internal()` subtracts busy blocks (with the service's buffers, like a booking) of
calendars that affect availability on connections not disconnected; `book_service()` re-runs it for the start
it is given, so a synced busy block refuses that start. Busy time is absolute instants, so a time-zone change or
DST cannot shift it; all-day events become instants in the calendar's zone (`allDayToInterval`, 23/25-hour days
tested). An outage keeps the busy time already synced (never opens a slot the coach is busy in). Voinic bookings
stay authoritative: an event created after a booking does not cancel it.

**Sync model for the worker**: push (Google watch channels / Graph subscriptions) or a coach action sets
`next_sync_at`; a safety-net sync every 6 h with push, 30 min without (`nextSafetySync`) — not a polling loop.
`syncConnection()` refreshes an expiring token, reads the calendar list and free/busy for 90 days, normalises
(clip, merge) and applies; failures become one stored code, never the provider's text. Minimum scopes:
Google `calendar.freebusy` + `calendar.calendarlist.readonly`; Microsoft `Calendars.ReadBasic` + `offline_access`.

## Marketplace launch readiness (pre-monetization)

Migration `20261112100000_marketplace_launch_readiness.sql`; pgTAP `marketplace_launch` (49);
`components/admin/coach-ops.tsx`; e2e `marketplace-discovery.spec.ts` (launch readiness, admin operations).

**Trustworthy numbers.** Ratings (count, average, distribution — and so the ranking's Bayesian rating) leave out
reviews by reviewers who are suspended or being deleted, as `coach_public_reviews()` already did: the count on the
page equals the reviews listed. Recomputed by triggers on `users.suspended_at` and `account_deletion_requests`.
Hidden reviews never count. Ranking engagement counts coaching requests once per live client (re-sending does not
pump it) and saves from live accounts only; views are one per visitor per day and never the coach's own; a coach
cannot save, review or book themselves. Weights unchanged; still one layer (`coach_ranked()`).

**Notices added**: `revision_approved` / `revision_returned` (category `marketplace`, from
`admin_decide_coach_revision`); `completed` (category `booking`, from `mark_booking`) asks the client for a review
once per coach and only while they have none. **Book** is shown only when the coach has weekly hours
(`coach_public_availability().has_hours`).

**Operations.** `/admin/coaches` gains *Needs attention* (`admin_coach_attention()`: open reports, reported reviews,
rejected verification, expired credentials, rating < 3 from 3+ reviews, a live profile missing its essentials, a
live profile on a suspended account, accepting clients but no sign-in for 60 days) and a rejected-verification
filter. `/admin/coaches/[id]` gains *Marketplace activity* and *Moderation history*
(`admin_coach_marketplace_summary()`: counts only, services in every state, every audited admin action on the
profile, its credentials, its reviews and the reports about it — who, from, to, reason). Credential decisions are
audited with what they replaced. Everything else (approve / send back / unpublish / suspend / restore,
verification, credentials, review hide / restore, report resolve / dismiss, revisions) already existed and is
unchanged: each an `admin_*` RPC behind `admin_assert()`, audited.

**SEO.** Landing listings are indexable and in the sitemap only with `LANDING_MIN_COACHES` (3) published coaches;
below that they work, `noindex, follow`. `/coaches/specialization/<slug>` and `/coaches/city/<slug>` 308 to
`/coaches/<slug>`. A removed coach answers 404 (not 410: Next's `notFound()` is the only status a page can set).

**Intent through sign-in**: Follow now carries `?intent=follow` like Save and Contact (`FollowIntent`).

**Journeys → where they are tested.** A anonymous discovery: `marketplace-discovery.spec.ts`. B client funnel and
C coach (request → accept → start → message → book → complete → review): `marketplace.spec.ts` part two
(`E2E_FUNNEL_FLOW=1`, writes) + pgTAP `coach_contact_requests`, `coach_bookings`, `coach_reviews`. D moderation:
pgTAP `marketplace_launch` (+ the admin e2e with `E2E_ADMIN_EMAIL`). E lifecycle: `coaching-lifecycle.spec.ts` +
pgTAP `coaching_lifecycle`. F double booking: `npm run db:test:race`.

## Engagement

`app/(client)/habits`. `addHabit` / `toggleHabit`; `getMyHabits`. Tables `habits`,
`habit_logs`, `streaks`, `badges`, `user_badges`. Components `add-habit-form.tsx`
(seven suggested habits from `lib/habit-suggestions.ts`, each with a "what" and
"why" in both languages before it is added), `habit-ticks.tsx` (an ⓘ on habits
that match a suggestion by name unfolds the same text). Streaks and badges have tables and RLS but no award logic —
those are service-role engine tables with no insert policy, and nothing writes them.

**Fitness score** — one 0..100 activity number over the last 28 local days,
an aggregation of signals that already exist: `0.35 · training load +
0.25 · consistency + 0.20 · frequency + 0.20 · volume`. Training load is the
mean per-session score from `training-load.ts` on the same saturating curve;
consistency is active workout days / 16 (the streak day rule, in
`users.timezone`); frequency is completed sessions / 16; volume is total kg /
50,000 (an app reference, not a physiological claim). Fewer than 3 completed
workouts in the window is "building" — no number is shown. Math and the
previous-block trend: `packages/shared/src/fitness-score.ts`; the one read:
[lib/fitness-score-data.ts](../apps/web/lib/fitness-score-data.ts) (sessions +
sets under RLS, so a coach sees a client's and nobody sees anyone else's);
UI: `components/fitness-score.tsx`, Today card, `/fitness-score`, the coach's
client page. Derived, never stored; no migration, no RPC. It is an
application activity metric, not a health or fitness assessment.

**External workout sharing** (Instagram Stories etc.). A completed session
becomes a 1080×1920 (Story) or 1080×1080 (Square) PNG drawn on a canvas in
the browser — nothing is stored. `lib/share-card.ts` (pure: the card is the
feed's `workoutPostPayload` snapshot + PR lines + author; `layoutShareCard`
places every element, absent stats leave no block) and `lib/share-card-render.ts`
(canvas painter, brand fonts via `--font-exo2` / `--font-inter`, Web Share API
with Save Image fallback). `lib/share-card-data.ts` builds the card server-side
through `getShareableSession` (owner-scoped); `app/share-card-actions.ts` is the
one action, taking a session id only. `components/share-workout.tsx` is the
button + preview dialog (format, Edit Stats, Show/Hide profile). Entries: the
done page (the session just finished), history rows on the day page, and
Today's "Last workout".

---

## Accounts, billing, admin

| | |
|---|---|
| Routes | `app/login`, `app/reset-password`, `app/auth/callback` (route handler), `app/(coach)/settings`, `app/(admin)/admin/*`, `app/(client)/billing` |
| Writes | [billing-actions.ts](../apps/web/app/billing-actions.ts) — `startCheckout`, `openBillingPortal`, `adminSetTier`; `createInvite` |
| Tables | `users`, `trainer_clients`, `subscriptions` |
| Migrations | `..._subscriptions.sql`, `..._admin_role.sql`, `..._stripe_billing.sql`, `..._signup_role.sql` |
| Edge function | `stripe-webhook` |
| Email templates | `supabase/templates/{confirmation,recovery}.html` — bilingual; wired in `config.toml` locally, pasted by hand into the hosted dashboard (the hosted project can edit templates only once custom SMTP is on). The confirmation link carries no `next`: sign-up saves it as user metadata `signup_next` and `/auth/callback` reads it back after `verifyOtp` (`lib/auth-redirect.ts`, through `safeNext`). A sign-in refused as "email not confirmed" offers **Resend confirmation email** (`auth.resend`, neutral answer, 60 s cooldown — `resendOutcome()` in `lib/auth-errors.ts`) |

**Auth is email + password, or Google.** The login page has three modes: sign
in, create account (full name, username, sex, age, coach/client choice,
password ≥ 8 + repeat — username / sex / birth year land in `users` through the
trigger, migration `20260910100000`; accounts without a username are sent to
`app/complete-profile`), and forgot password; the first two also offer "Continue with Google"
(`signInWithOAuth`). Email sign-up passes `{ full_name, role }` as user
metadata; the `handle_new_user` trigger accepts only `coach`/`client` and
defaults everything else to `client`, so a sign-up request can never mint an
admin (`supabase/tests/signup_role.test.sql`). Google cannot carry metadata, so
the choice rides on the callback URL as `?role=` and the callback calls
`claim_signup_role()`, which only acts on a row created in the last 10 minutes
(`role_not_self_service.test.sql`) — or, since `20260917100000`, on a row whose
`username` is still null, because the "sign in" tab's Google button creates
accounts with no role choice at all and `/complete-profile` is where they are
first asked (`profile_extras.test.sql`). The complete-profile action claims the
role *before* writing the username, since the username closes that window. The same migration makes the `users`
update grant column-level — `role` is not on it, so nobody can PATCH their own
role over REST. Emailed links and the OAuth return both land on
`/auth/callback`, which verifies a `token_hash` (our templates) or exchanges a
PKCE `code` (Supabase's default templates and OAuth) and continues to `next`.
Supabase's English auth errors are mapped to locale strings in
`lib/auth-errors.ts`. If the project has email confirmation on, sign-up shows a
"check your inbox" state instead of redirecting. Google needs the provider
enabled per project (dashboard for hosted, `config.toml` + env vars locally).
No Apple, no onboarding — see GAPS.

**Entitlements live in one table.** `subscriptions` stores only who has which tier
(`free`, `premium`, `coach_free`, `coach_pro`); tier → feature mapping is code in
`packages/shared/src/entitlements.ts`. Every new profile gets a row via the
`on_profile_created` trigger, and `effective_tier()` folds the 30-day trial in, so
a trialling user reads as their paid tier without a payment record. Stripe is
wired (checkout + portal + webhook); monthly and ~15%-off annual prices, and an
admin can grant a tier directly with `admin_set_tier`.

**Paywall (2026-09-23, built and switched off).** Migration
`20260923120000_paywall.sql`, test `supabase/tests/paywall.test.sql` (17
assertions, run live inside a rolled-back transaction before applying).

- *The switch* is `app_flags.paywall` (`enabled`, plus `preview_users uuid[]`
  to turn it on for a few accounts first). Off — the state it shipped in — every
  gate is open: `planEntitlements()` answers the role's full paid set, the limit
  triggers let everything through, `/billing` still redirects to `/account` and
  the coach settings hide the subscription card. Only the roster cap (3 / 30 in
  `create_invite`) applies either way, as it always has.
- *Tiers.* `own_tier()` is the old `effective_tier()` plus one fix (a coach
  whose trial ended is `coach_free`, not `free`). `effective_tier()` now gives a
  plain client **Premium while their active coach's own tier is `coach_pro`**.
  Mirrored in `effectiveTier()` (`packages/shared/src/billing.ts`).
- *What the app reads.* `getProfile` selects the definer view `my_plan`
  (effective tier, own tier, `paywall`, trial, `has_stripe`) in place of the old
  `subscriptions` select — same wave. `lib/plan.ts` `getPlan()` turns it into
  `{ e: Entitlements, historySince, upgrade }`; both layouts mount it for client
  components as `PlanProvider` / `usePlan()` (`lib/plan-client.tsx`).
- *Limits SQL enforces* (`plan_limit()` mirrors `ENTITLEMENTS`, pinned by
  `entitlements.test.ts`): own programs, custom exercises, favourite foods via
  the `enforce_plan_limit` trigger, and barcode scans per local day via
  `claim_barcode_scan()` (called by `lookupBarcode` beside the cache read). Each
  raises `PLAN_LIMIT_REACHED`; screens show `UpgradeHint` (`components/upgrade.tsx`).
- *Gates checked in app code* — display of the person's own data, or a Pro
  control in a server action: history window (30 days of sessions, day history,
  weigh-in list, photos, food diary), progress charts + full PR list +
  fitness-score trend/breakdown, photo comparison, share-card customisation,
  setting your own exercise video, coach adherence signal/reason/% and a
  client's fitness score, duplicating a day and **Copy to client** (new, in the
  program builder: `copyProgramToClient`), ingredient-based meal plans
  (`addPlanFood`). Headline counts (sessions, volume, PRs) always count
  everything, so the coach's and client's numbers never disagree.
- To preview: `update public.app_flags set preview_users = array['<uuid>']::uuid[] where key = 'paywall';`
  — note the seeded test accounts are all on trials or manual grants, so a
  gate only shows once their `subscriptions` row is free and the trial is past.

**Admin panel** (`app/(admin)/admin/*`, 2026-09-20). Read-mostly operations
desk: `lib/admin/data.ts` wraps one `admin_*` RPC per page; each RPC is
`security definer` and opens with `admin_assert()` (raises `42501` unless
`is_admin()`), so the `/admin` prefix is a view, not the boundary. Email, last
sign-in and provider come from `auth.users` / `auth.identities` only through
those RPCs; **login history from `public.admin_login_events`** — a view over
the USER_LOGIN audit rows, because `auth.audit_log_entries` is empty on a
hosted Supabase project and every login figure in the panel read 0 until
20260922100000 (it falls back to GoTrue's log only while our own stream is
empty, which is the local stack). `admin_audit_events`
is an append-only stream written by triggers on users, auth.users
(`last_sign_in_at`), trainer_clients, programs, logged_sessions, logged_sets,
exercises, challenges, social_*, push_subscriptions and
account_deletion_requests, plus the admin actions themselves; a `before update
or delete` trigger refuses edits from every API role. Failed password sign-ins
are reported by the login form through `record_login_failure()` (anonymous,
flood-capped). Admin writes: `admin_set_suspended` (sets `users.suspended_at`;
both app layouts redirect a suspended account to `/suspended`),
`admin_revoke_invitation`, `admin_delete_post` (soft), `admin_remove_push_subscription`,
`admin_set_tier` (now audited), `admin_resolve_app_error`. Tests:
`supabase/tests/admin_panel.test.sql` (101 assertions), `lib/admin/params.test.ts`.

**Application errors** (`/admin/errors`, `app_errors`, 2026-09-22). The panel's
"Application errors" tile used to be an honest dash; there is a store now.
`app/error.tsx`, `app/global-error.tsx` and `(admin)/error.tsx` each mount
`components/error-reporter.tsx`, which calls `reportAppError`
(`app/error-actions.ts`) → `record_app_error()` — security definer, callable by
anon (an error boundary fires for a signed-out visitor too) and capped at 20
rows an hour per user, 40 per address. The row holds the message, the Next.js
digest, the route, a trimmed stack, the user agent and the IP; never a form
value, a token or a request body. Reads go through `admin_app_errors()`, which
returns the counters, the distinct messages ranked by frequency, and one page of
raw rows; `admin_resolve_app_error(id, all_alike)` marks rather than deletes.
Nothing reports server-side failures that never reach a boundary — a caught
error in a server action is still only a console line.

One active coach per client is enforced by `trainer_clients` + invite codes
(`create_invite()`), and it is what `is_active_coach_of()` — and therefore every
coach-side RLS policy — keys off.

---

## Cross-cutting

- **Onboarding surfaces:** landing `app/page.tsx`, `get-the-app`, `privacy`,
  `terms`, `cookie-banner.tsx`, `language-selector.tsx`.
- **Sync:** `supabase/functions/sync-ingest` + `packages/shared/src/sync.ts` —
  the offline outbox endpoint for the mobile app that does not exist yet.
  Append-only entities dedupe on `client_generated_id`, conflicts are
  last-write-wins by `client_ts`.
- **Push:** `supabase/functions/push-dispatch`. No client registers a token.
- **Exercise library:** `app/(coach)/library`, `lib/exercise-library.ts`,
  `supabase/functions/import-exercises`.
