"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useOptimistic, useReducer, useRef, useState, useTransition } from "react";
import type { PhotoOverlay, PostVisibility, ReactionType } from "@healthapp/shared";
import { applyReaction, displayToKg, followButtonState, isAchievementRarity, kudosSummary, postPhotoOf, POST_MEDIA_MAX, POST_TEXT_MAX, type ReactionState } from "@healthapp/shared";
import {
  createProgressPost, createTextPost, deletePost, editPost, follow, loadComments, loadKudos, react, requestPostPhotoUpload, setPostSaved,
  sharePost, unfollow,
  type PostPhotoInput,
} from "@/app/social-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { parseDay } from "@/lib/week";
import { durationLabel } from "@/lib/share-card";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { preparePhoto } from "@/lib/image-prepare";
import type { OverlayStatValues } from "@/lib/photo-overlay";
import { renderPhotoStory, storyFileName } from "@/lib/photo-story";
import { canShareFile, deliverShareImage } from "@/lib/share-card-render";
import type { CommentPage, FeedPost, KudosGiver, ShareableSession } from "@/lib/types";
import { NavIcon } from "./client-nav";
import { Card } from "./ui";
import { SOCIAL } from "@/lib/social-ui";
import { captionFolds, doubleTapGives, giveNeedsUndo, isDoubleTap, postAge } from "@/lib/post-card";
import { canRepost, canWebShare, postShareUrl, saveReducer, shareTargets } from "@/lib/post-share";
import { BadgeGlyph, MentionSuggestions, MentionText, useMentionSuggest } from "./social-v2";
import { CommentPreview } from "./comment-preview";
import { ModerationMenuButton } from "./moderation";
import { ReactionIcon } from "./reaction-icons";
import { PhotoFrame, PhotoOverlayEditor } from "./photo-overlay";
import { MediaGallery } from "./media-gallery";
import { CAMERA, MEDIA_ACCEPT, MediaTray, useMediaDraft } from "./media-picker";
import { draftBusy, publishPlan } from "@/lib/media-draft";
import { CommentThread } from "./comment-thread";

// ---------- small pieces ----------

// 24-box stroke paths, the client app's icon vocabulary. Emoji that carries
// data (avatars, badge art) stays; decorative emoji became one of these.
// Kept module-local on purpose: every export of a "use client" module becomes a
// client reference, so a server component must not import these strings.
const FLAME = "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z";
const TROPHY = "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4";
const COMMENT = "M4 5h16v11H9l-5 4z";
const DUMBBELL = "M6.5 6.5v11M9.5 8.5v7M14.5 8.5v7M17.5 6.5v11M9.5 12h5";
const TREND = "m2 17 6.5-6.5 5 5L22 7M16 7h6v6";
const CHECK = "m5 12 5 5 9-10";
const CLOSE = "M6 6l12 12M18 6L6 18";
const GLOBE = "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18";
const PEOPLE = "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1a4 4 0 0 0-3-3.9M16.5 4.1a4 4 0 0 1 0 7.8";
const LOCK = "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z";
const SEND = "M22 2 11 13M22 2l-7 20-4-9-9-4z";
const BOOKMARK = "M6 3h12v18l-6-4.5L6 21z";
const LINK = "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1";
const REPOST = "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3";
const EXTERNAL = "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v12M7 8l5-5 5 5";
const UNAVAILABLE = "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M5.6 5.6l12.8 12.8";
const VIS_ICON: Record<PostVisibility, string> = { public: GLOBE, followers: PEOPLE, private: LOCK };

export function Avatar({ name, url, size = "h-9 w-9" }: { name: string; url: string | null; size?: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-ink`}>
      {initial}
    </span>
  );
}

export function useSocialFormat() {
  const { t, locale } = useI18n();
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const nf = new Intl.NumberFormat(tag);
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" });
  const dtf = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const s = t.common.social;
  return {
    n: (v: number) => nf.format(v),
    day: (d: string) => df.format(parseDay(d)),
    /** "2m ago", "1h ago", "Yesterday", "3d ago", then the date — computed once, never ticking. */
    when: (iso: string) => {
      const age = postAge(iso, Date.now());
      switch (age.unit) {
        case "now": return s.justNow;
        case "minutes": return fill(s.minutesAgo, { m: age.n });
        case "hours": return fill(s.hoursAgo, { h: age.n });
        case "yesterday": return s.yesterday;
        case "days": return fill(s.daysAgo, { d: age.n });
        default: return dtf.format(new Date(iso));
      }
    },
    /** The exact moment, for a hover title next to the relative label. */
    at: (iso: string) => dtf.format(new Date(iso)),
    duration: durationLabel,
  };
}

/** The eyebrow every payload block shares: an icon and a small caps label. */
function BlockLabel({ icon, children, tone = "text-accent-ink" }: { icon: string; children: React.ReactNode; tone?: string }) {
  return (
    <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${tone}`}>
      <NavIcon d={icon} className="h-[15px] w-[15px]" />
      {children}
    </p>
  );
}

export function VisibilityPicker({ value, onChange }: { value: PostVisibility; onChange: (v: PostVisibility) => void }) {
  const { t } = useI18n();
  const s = t.common.social;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{s.visibilityLabel}</span>
      <div className="inline-flex gap-1 rounded-full bg-bg p-1">
        {(["public", "followers", "private"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`h-8 rounded-full px-3 text-[12.5px] font-semibold transition-colors ${
              value === v ? "bg-accent text-accent-fg" : "text-ink-soft hover:text-ink"
            }`}
          >
            {s.visibility[v]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- post content by type ----------

/** One big figure of the workout tile: the number in Exo 2, the unit and label quiet. */
function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-display text-[26px] font-extrabold leading-none tracking-tight tabular-nums sm:text-[28px]">
        {value}
        {unit ? <span className="ml-1 font-sans text-[13px] font-semibold text-tile-soft">{unit}</span> : null}
      </p>
      <p className="mt-1.5 text-[11.5px] text-tile-soft">{label}</p>
    </div>
  );
}

/** A workout's figures, formatted for the reader, keyed the way the photo overlay wants them. */
export function useOverlayStats(w: { duration_min: number | null; volume_kg: number; sets: number; exercises: number; load: number; prs: number } | null): OverlayStatValues {
  const { t } = useI18n();
  const f = useSocialFormat();
  const s = t.common.social;
  if (!w) return {};
  const dur = f.duration(w.duration_min);
  return {
    ...(dur ? { duration: { value: dur, label: s.statDuration } } : {}),
    volume: { value: f.n(w.volume_kg), unit: "kg", label: s.statVolume },
    sets: { value: f.n(w.sets), label: s.statSets },
    exercises: { value: f.n(w.exercises), label: s.statExercises },
    load: { value: f.n(w.load), label: s.statLoad },
    ...(w.prs > 0 ? { prs: { value: f.n(w.prs), label: s.statPrs } } : {}),
  };
}

/**
 * The picture a post leads with — its legacy payload photo, or the first of
 * its pictures — in the one shape the story export and the edit form read.
 */
function primaryPhoto(post: FeedPost): ReturnType<typeof postPhotoOf> {
  const legacy = postPhotoOf(post.payload);
  if (legacy) return legacy;
  const first = post.media[0];
  return first ? { url: first.url, width: first.width, height: first.height, overlay: first.overlay } : null;
}

/**
 * The photo on a text or progress post, with whatever sits on it. `splash`
 * is the double-tap layer the card mounts over every photo.
 */
function PostPhoto({ post, splash }: { post: FeedPost; splash: React.ReactNode }) {
  const photo = postPhotoOf(post.payload);
  if (!photo) return null;
  return (
    <div className="mx-3 overflow-hidden rounded-2xl">
      <PhotoFrame src={photo.url} width={photo.width} height={photo.height} overlay={photo.overlay} stats={{}}>
        {splash}
      </PhotoFrame>
    </div>
  );
}

/**
 * The post's "media", where a photo would sit on Instagram: a workout is an
 * inverse tile with its figures large, a record or a milestone a solid gold
 * tile with the number as the hero. Text and progress posts have a photo or
 * nothing.
 */
export type PostPhoto = { publicId: string; version: number; width: number; height: number; previewUrl: string };

function PostMedia({ post, splash }: { post: FeedPost; splash: React.ReactNode }) {
  const { t, locale } = useI18n();
  const f = useSocialFormat();
  const s = t.common.social;
  const p = post.payload;
  const overlayStats = useOverlayStats(p?.kind === "workout" ? p : null);
  // Pictures on a text or progress post (20261016100000): the same gallery
  // on every surface. Posts from before them keep their one legacy photo.
  if (post.media.length > 0 && (post.type === "text" || post.type === "progress")) {
    return <MediaGallery items={post.media} authorName={post.author_name} splash={splash} />;
  }
  if (!p) return null;
  if (p.kind === "progress" || p.kind === "text") return <PostPhoto post={post} splash={splash} />;

  if (p.kind === "workout") {
    const dur = f.duration(p.duration_min);
    const photo = postPhotoOf(p);
    const stats = (
      <>
        <div className={`grid gap-3 ${dur ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
          {dur ? <Stat value={dur} label={s.statDuration} /> : null}
          <Stat value={f.n(p.volume_kg)} unit="kg" label={s.statVolume} />
          <Stat value={f.n(p.sets)} label={s.statSets} />
          <Stat value={f.n(p.exercises)} label={s.statExercises} />
        </div>
        <div className="mt-4 flex items-center gap-3 text-[12.5px] font-semibold text-tile-accent">
          <span className="flex shrink-0 items-center gap-1.5">
            <NavIcon d={FLAME} className="h-4 w-4" />
            <span className="tabular-nums">{fill(s.trainingLoad, { load: p.load })}</span>
          </span>
          {/* Load is 0..100 by construction, so a bar is an honest picture of it. */}
          <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-tile-line" aria-hidden>
            <span className="block h-full rounded-full bg-tile-accent" style={{ width: `${p.load}%` }} />
          </span>
          {p.prs > 0 ? (
            <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-tile-accent px-2.5 text-[11.5px] font-bold text-tile">
              <NavIcon d={TROPHY} className="h-3.5 w-3.5 [stroke-width:2.2]" />
              {p.prs === 1 ? s.prOne : fill(s.prMany, { count: p.prs })}
            </span>
          ) : null}
        </div>
      </>
    );

    // With a photo the card becomes what people came for: the picture full
    // bleed, and either what the author placed on it (the figures, a line of
    // text — the overlay) or, on a post from before overlays existed, the
    // workout's name and headline numbers behind a gradient at the bottom.
    // The rest of the figures sit underneath on the tile. Without a photo it
    // is the tile alone, exactly as before.
    const scrim = photo !== null && !photo.overlay?.stats;
    return (
      <div className="mx-3 overflow-hidden rounded-2xl bg-tile text-tile-ink">
        {photo ? (
          <PhotoFrame src={photo.url} width={photo.width} height={photo.height} overlay={photo.overlay} stats={overlayStats}>
            {scrim ? (
              // The scrim exists so white text is legible on any photo; it is
              // opaque at the bottom and clear at the top, so the picture is
              // never dimmed where nothing sits on it.
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-5 pb-4 pt-14 text-white">
                <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-white/70">
                  <NavIcon d={DUMBBELL} className="h-3.5 w-3.5" />
                  {s.workoutPost}
                </span>
                <p className="mt-1 truncate font-display text-[24px] font-extrabold leading-tight tracking-tight">{p.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12.5px] font-semibold tabular-nums text-white/85">
                  {dur ? <span>{dur}</span> : null}
                  <span>{fill(s.volume, { kg: f.n(p.volume_kg) })}</span>
                  <span>{fill(s.setsCount, { count: p.sets })}</span>
                </p>
              </div>
            ) : null}
            {splash}
          </PhotoFrame>
        ) : null}
        <div className="px-5 pb-5 pt-4">
          {scrim ? null : (
            <>
              <BlockLabel icon={DUMBBELL} tone="text-tile-accent">{s.workoutPost}</BlockLabel>
              <p className="mb-4 mt-1 truncate font-display text-[26px] font-extrabold leading-tight tracking-tight">{p.name}</p>
            </>
          )}
          {stats}
        </div>
      </div>
    );
  }

  // The gold tiles: a record, a finished challenge, a streak milestone.
  const gold = "mx-3 rounded-2xl bg-accent px-5 pb-5 pt-4 text-accent-fg";
  const label = "text-accent-fg/70";
  const hero = "mt-2 font-display text-[44px] font-black leading-none tracking-tight tabular-nums sm:text-[48px]";
  if (p.kind === "pr") {
    return (
      <div className={gold}>
        <BlockLabel icon={TROPHY} tone={label}>{s.newPr}</BlockLabel>
        <p className={hero}>
          {f.n(p.weight_kg)}
          <span className="ml-1 font-sans text-[17px] font-semibold opacity-70">kg</span>
          <span className="ml-2.5 font-sans text-[21px] font-bold opacity-80">× {p.reps}</span>
        </p>
        <p className="mt-2.5 text-[15px] font-semibold">{p.exercise}</p>
        <p className="mt-0.5 text-[12.5px] opacity-70">{s.personalBest}</p>
      </div>
    );
  }
  if (p.kind === "challenge_completed") {
    return (
      <div className={gold}>
        <BlockLabel icon={TROPHY} tone={label}>{s.challengeCompleted}</BlockLabel>
        <p className="mt-2 font-display text-[26px] font-extrabold leading-tight tracking-tight">{locale === "ro" ? p.title_ro : p.title_en}</p>
        <p className="mt-1.5 text-[15px] font-semibold tabular-nums opacity-80">
          {f.n(p.value)} / {f.n(p.target)} {t.common.challenges.unit[p.type as keyof typeof t.common.challenges.unit] ?? ""}
        </p>
      </div>
    );
  }
  // A shared routine. Not gold: the gold tiles are things somebody achieved,
  // and a program is an invitation to train, not a result. Everything on it
  // comes from the snapshot taken when it was posted, so editing the routine
  // afterwards never rewrites the post — only the link leads to today's version.
  if (p.kind === "program") {
    const r = t.clientApp.routines;
    const facts = [
      fill(r.daysCount, { count: p.days }),
      fill(r.exercisesCount, { count: p.exercises }),
      p.est_minutes > 0 ? fill(r.aboutMinutes, { count: p.est_minutes }) : null,
      p.level ? r.level[p.level] : null,
      p.goal ? r.goal[p.goal] : null,
    ].filter((x): x is string => Boolean(x));
    return (
      <Link
        href={`/routines/${p.program_id}`}
        className="mx-3 block rounded-2xl bg-bg px-5 pb-5 pt-4 transition hover:bg-accent-soft/40"
      >
        <BlockLabel icon={DUMBBELL} tone="text-ink-faint">{r.sharedRoutine}</BlockLabel>
        <p className="mt-2 font-display text-[22px] font-extrabold leading-tight tracking-tight">{p.name}</p>
        {p.description ? <p className="mt-1.5 text-[13px] text-ink-soft">{p.description}</p> : null}
        <p className="mt-2 text-[12.5px] tabular-nums text-ink-faint">{facts.join(" · ")}</p>
        {p.muscle_groups.length > 0 ? (
          <p className="mt-1 text-[12px] text-ink-faint">{p.muscle_groups.join(" · ")}</p>
        ) : null}
      </Link>
    );
  }
  // An earned badge: the name comes from the snapshot the database built from
  // the catalog when it was posted, never from the browser.
  if (p.kind === "achievement") {
    return (
      <div className={gold}>
        <BlockLabel icon={TROPHY} tone={label}>{s.achievementPost}</BlockLabel>
        <div className="mt-3 flex items-center gap-3.5">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent-fg/15">
            <BadgeGlyph icon={p.icon} className="h-7 w-7 [stroke-width:2]" />
          </span>
          <p className="min-w-0 font-display text-[26px] font-extrabold leading-tight tracking-tight">
            {(locale === "ro" ? p.name_ro : p.name_en) ?? p.badge_slug}
          </p>
        </div>
        {/* Rarity as the catalog had it when shared; older posts carry none. */}
        {isAchievementRarity(p.rarity) ? (
          <p className="mt-2.5 text-[11px] font-bold uppercase tracking-wider opacity-75">
            {t.common.achievements.rarities[p.rarity]}
          </p>
        ) : null}
      </div>
    );
  }
  // A Fitness Score milestone: the score and the milestone it passed. Nothing
  // about the sessions behind it is in the snapshot, so nothing is shown.
  if (p.kind === "fitness_score") {
    return (
      <div className={gold}>
        <BlockLabel icon={TREND} tone={label}>{s.fitnessScorePost}</BlockLabel>
        <p className={hero}>
          {p.score}
          <span className="ml-1.5 font-sans text-[17px] font-semibold opacity-70">/ 100</span>
        </p>
        <p className="mt-2.5 text-[15px] font-semibold">{fill(s.fitnessScoreReached, { milestone: p.milestone })}</p>
      </div>
    );
  }
  if (p.kind !== "streak") return null;
  return (
    <div className={gold}>
      <BlockLabel icon={FLAME} tone={label}>{t.common.streaks.title}</BlockLabel>
      <p className={hero}>
        {p.milestone}
        <span className="ml-2 font-sans text-[17px] font-semibold opacity-70">{t.common.streaks.days}</span>
      </p>
      <p className="mt-2.5 text-[15px] font-semibold">{fill(t.common.streaks.milestoneTitle, { count: p.milestone })}</p>
      <p className="mt-0.5 text-[12.5px] opacity-70">{fill(t.common.streaks.postBody, { count: p.streak_days })}</p>
    </div>
  );
}

// ---------- the card ----------

/**
 * The reactions on one post. `press` is a button: the same one again takes
 * the reaction back, the other one replaces it (applyReaction mirrors
 * social_react). The state is local and moves at once; the server action
 * runs behind it, queued so two quick presses reach the database in order,
 * and the row it answers with is what the card settles on. Nothing refreshes
 * the page: a reaction is one small write, not a reason to re-render the
 * feed. Other people's counts arrive with the next navigation, and a refresh
 * from elsewhere on the page (a comment) re-seeds the state from the row.
 * `burst` changes whenever a reaction was GIVEN, which is what the sparks and
 * the splash key off; taking one back is quiet.
 */
function useReactions(post: FeedPost) {
  const [error, setError] = useState<string | null>(null);
  const [burst, setBurst] = useState<{ type: ReactionType; at: number } | null>(null);
  const [state, setState] = useState<ReactionState>({ my_reaction: post.my_reaction, kudos_count: post.kudos_count, love_count: post.love_count });
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  // The row is the truth whenever it arrives anew.
  useEffect(() => {
    setState({ my_reaction: post.my_reaction, kudos_count: post.kudos_count, love_count: post.love_count });
  }, [post.my_reaction, post.kudos_count, post.love_count]);

  const press = useCallback((pressed: ReactionType, opts: { onlyGive?: boolean } = {}) => {
    if (post.mine) return;
    setState((cur) => {
      // A double-tap on the photo gives, never takes back — Instagram's rule,
      // and the one that keeps a stray second tap from undoing the first.
      if (opts.onlyGive && cur.my_reaction === pressed) {
        setBurst({ type: pressed, at: Date.now() });
        return cur;
      }
      if (cur.my_reaction !== pressed) setBurst({ type: pressed, at: Date.now() });
      setError(null);
      queue.current = queue.current.then(async () => {
        const r = await react(post.id, pressed);
        if (!r.ok) {
          setError(r.message ?? "Error");
          setState(cur); // back to what the card showed before this press
          return;
        }
        // Two presses raced and the database settled differently: follow the row.
        const settled = r.reaction ?? null;
        setState((now) => (now.my_reaction === settled ? now : applyReaction(now, settled ?? now.my_reaction!)));
      });
      return applyReaction(cur, pressed);
    });
  }, [post.mine, post.id]);

  return { state, press, error, burst };
}

/**
 * Double-tap (or double-click) on the photo: kudos, with the arm blooming in
 * the middle of the picture. Wraps the photo's own children so the overlay's
 * pointer-events: none stays intact.
 */
function DoubleTap({ onDouble, burst }: { onDouble: () => void; burst: { type: ReactionType; at: number } | null }) {
  const last = useRef(0);
  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className="absolute inset-0 cursor-default"
        onPointerUp={(e) => {
          if (e.pointerType === "mouse") return; // mice double-click
          const now = Date.now();
          if (now - last.current < 320) { last.current = 0; onDouble(); } else last.current = now;
        }}
        onDoubleClick={onDouble}
      />
      {burst ? (
        <span key={burst.at} className="pointer-events-none absolute inset-0 grid place-items-center">
          <ReactionIcon type={burst.type} className="reaction-splash h-[28cqw] w-[28cqw] max-h-40 max-w-40" />
        </span>
      ) : null}
    </>
  );
}

/**
 * One post, laid out like the feeds people already know: header (who, when,
 * who can see it), media, caption, then the action row and the "X reacted"
 * line under it. The comment icon opens the thread right there, box focused
 * — one tap to comment, not three. The detail page adds the delete control
 * for own posts and keeps the thread below the card instead.
 */
export function PostCard({ post, detail = false, removeOnUnsave = false }: {
  post: FeedPost;
  detail?: boolean;
  /** The feed column passes it; the card keeps one shape everywhere. */
  bleed?: boolean;
  /** On /saved: unsaving takes the card away at once, and brings it back if the request fails. */
  removeOnUnsave?: boolean;
}) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const s = t.common.social;
  const p = post.payload;
  const caption = p !== null; // text under a tile, a photo or an eyebrow reads as a caption; alone it is the post
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.text ?? "");
  const [editError, setEditError] = useState<string | null>(null);
  const reactions = useReactions(post);
  const save = useSave(post);
  const [sharing, setSharing] = useState(false);
  const [removed, setRemoved] = useState(false);
  const photo = primaryPhoto(post);
  const overlayStats = useOverlayStats(p?.kind === "workout" ? p : null);
  const [story, setStory] = useState<"idle" | "busy" | "ready" | "shared" | "failed">("idle");
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(post.comment_count);
  useEffect(() => setCommentCount(post.comment_count), [post.comment_count]);

  // The story export of an own post's photo — the same picture and overlay
  // the card shows, at 1080×1920 with the mark in the corner.
  async function downloadStory() {
    if (!photo || !photo.width || !photo.height) return;
    setStory("busy");
    try {
      const blob = await renderPhotoStory({
        photoUrl: photo.url, width: photo.width, height: photo.height, overlay: photo.overlay, stats: overlayStats, brand: APP_NAME, tagline: APP_TAGLINE,
        workout: p?.kind === "workout" ? { kicker: s.workoutPost, name: p.name, date: f.day(p.date) } : null,
      });
      const date = p?.kind === "workout" ? p.date : post.created_at.slice(0, 10);
      const how = await deliverShareImage(blob, storyFileName(date), p?.kind === "workout" ? p.name : APP_NAME);
      setStory(how === "shared" ? "shared" : how === "saved" ? "ready" : "idle");
    } catch {
      setStory("failed");
    }
  }

  if (removed) return null;
  if (removeOnUnsave && !save.saved) return null;

  const splash = post.mine ? null : (
    <DoubleTap onDouble={() => reactions.press("kudos", { onlyGive: true })} burst={reactions.burst} />
  );

  return (
    <article className="rounded-3xl bg-surface pb-2.5">
      <div className="flex items-center gap-3 px-5 pb-3.5 pt-4">
        <Link href={`/people/${post.user_id}`} className="shrink-0">
          <Avatar name={post.author_name} url={post.author_avatar} size="h-11 w-11" />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/people/${post.user_id}`} className="block truncate text-[15px] font-semibold leading-tight hover:text-accent-ink">
            {post.author_name}
          </Link>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-faint">
            <span>{f.when(post.created_at)}</span>
            <span aria-hidden>·</span>
            <NavIcon d={VIS_ICON[post.visibility]} className="h-[13px] w-[13px]" />
            <span>{s.visibility[post.visibility]}</span>
            {post.edited_at ? (
              <>
                <span aria-hidden>·</span>
                <span>{s.edited}</span>
              </>
            ) : null}
          </p>
        </div>
        {post.mine && !editing ? (
          <PostMenu
            pending={pending}
            onEdit={() => {
              setDraft(post.text ?? "");
              setEditError(null);
              setEditing(true);
            }}
            // Delete from the feed too, behind a confirmation: the menu is
            // one tap from the caption, and a post is not something to lose to
            // a slip. From the post's own page the deletion leads back to the feed.
            onDelete={() => {
              if (!window.confirm(s.deletePostConfirm)) return;
              startTransition(async () => {
                await deletePost(post.id);
                if (detail) router.push("/feed");
                router.refresh();
              });
            }}
            onStory={photo && photo.width && photo.height ? downloadStory : undefined}
            storyBusy={story === "busy"}
          />
        ) : !post.mine ? (
          // Someone else's post: Mute / Block / Report. A blocked author's posts
          // never reach the page — the server filters them — so never "blocked" here.
          <ModerationMenuButton
            target={{ userId: post.user_id, name: post.author_name }}
            postId={post.id}
            muted={post.author_muted}
            blocked={false}
            place="post"
            // Blocked: gone from here at once. Muted: the refresh decides —
            // it leaves the feed but stays on the author's own profile.
            onChanged={(what) => { if (what === "blocked") setRemoved(true); }}
          />
        ) : null}
      </div>

      {post.type === "shared_post" ? <SharedEmbed post={post} /> : <PostMedia post={post} splash={splash} />}
      {story === "ready" || story === "shared" || story === "failed" ? (
        <p role="status" className={`mt-2 px-5 text-[12px] ${story === "failed" ? "text-risk" : "text-accent-ink"}`}>
          {story === "failed" ? s.storyFailed : story === "shared" ? s.storyShared : s.storyReady}
        </p>
      ) : null}

      {p?.kind === "progress" ? (
        <div className="px-5">
          <BlockLabel icon={TREND}>{s.progressUpdate}</BlockLabel>
        </div>
      ) : null}
      {editing ? (
        // Only the caption is editable: the tile above is the snapshot, and
        // the database refuses any other column (column-level update grant).
        <form
          className="px-5 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            setEditError(null);
            startTransition(async () => {
              const r = await editPost(post.id, draft);
              if (!r.ok) {
                setEditError(r.message ?? s.textInvalid);
                return;
              }
              setEditing(false);
              router.refresh();
            });
          }}
        >
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, POST_TEXT_MAX))}
            maxLength={POST_TEXT_MAX}
            rows={3}
            aria-label={s.editPost}
            className="w-full resize-none rounded-2xl border border-line bg-bg px-3.5 py-3 text-[15px] outline-none focus:border-accent"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <span className="mr-auto text-[11px] tabular-nums text-ink-faint">{draft.length}/{POST_TEXT_MAX}</span>
            <button
              type="button"
              onClick={() => { setEditing(false); setEditError(null); }}
              className="h-10 rounded-xl px-3.5 text-[13px] font-semibold text-ink-faint hover:bg-bg hover:text-ink"
            >
              {s.cancelEdit}
            </button>
            <button
              type="submit"
              // A text post needs words; a workout or badge may lose its caption.
              disabled={pending || (post.type === "text" && !photo && draft.trim().length === 0)}
              className="h-10 rounded-xl bg-accent px-4 font-display text-[13px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              {s.saveEdit}
            </button>
          </div>
          {editError ? <p className="mt-1.5 text-xs text-risk">{editError}</p> : null}
        </form>
      ) : post.text ? (
        // Handles are links only where a social_post_mentions row says so.
        <MentionText
          text={post.text}
          mentions={post.mentions ?? []}
          className={`whitespace-pre-wrap break-words px-5 leading-relaxed ${caption ? "mt-3 text-[15px]" : "text-[17px]"}`}
        />
      ) : null}
      {p?.kind === "progress" && typeof p.weight_kg === "number" ? (
        <p className="mt-1 px-5 text-[12.5px] tabular-nums text-ink-faint">{f.n(p.weight_kg)} kg</p>
      ) : null}

      <Reactions
        post={post}
        reactions={reactions}
        comments={
          detail ? (
            <span className="inline-flex h-10 items-center gap-2 px-2.5 font-semibold text-ink-soft">
              <NavIcon d={COMMENT} className="h-[22px] w-[22px]" />
              <span className="text-[14px] tabular-nums">{post.comment_count}</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setCommentsOpen((v) => !v)}
              aria-expanded={commentsOpen}
              title={s.comments}
              className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-full px-2.5 font-semibold transition-colors ${
                commentsOpen ? "bg-bg text-ink" : "text-ink-soft hover:bg-bg hover:text-ink"
              }`}
            >
              <NavIcon d={COMMENT} className="h-[22px] w-[22px]" />
              <span className="text-[14px] tabular-nums">{commentCount}</span>
            </button>
          )
        }
        extra={
          <>
            <button
              type="button"
              onClick={() => setSharing(true)}
              aria-label={s.share}
              aria-haspopup="dialog"
              title={s.share}
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bg hover:text-ink"
            >
              <NavIcon d={SEND} className="h-[22px] w-[22px] -translate-y-px" />
            </button>
            <button
              type="button"
              onClick={save.toggle}
              aria-pressed={save.saved}
              aria-busy={save.pending}
              aria-label={save.saved ? s.unsave : s.save}
              title={save.saved ? s.unsave : s.save}
              className="ml-auto inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-bg hover:text-ink"
            >
              <NavIcon d={BOOKMARK} className={`h-[22px] w-[22px] ${save.saved ? "[&>path]:fill-current" : ""}`} />
            </button>
          </>
        }
      />
      {save.error ? <p role="status" className="mt-1 px-5 text-[11px] text-risk">{s.saveError}</p> : null}
      {sharing ? <ShareSheet post={post} onClose={() => setSharing(false)} /> : null}
      {commentsOpen && !detail ? (
        <InlineComments postId={post.id} onPosted={() => setCommentCount((n) => n + 1)} />
      ) : !detail ? (
        // Closed: the newest comments, so a thread is visible before it is opened.
        <CommentPreview postId={post.id} total={commentCount} items={post.comment_preview} />
      ) : null}
    </article>
  );
}

/**
 * The thread under a feed card, opened by the comment icon: the first page
 * of comments (with replies), fetched when it opens, and the box already
 * focused — the icon was tapped to write. A post reloads the page of
 * comments, never the feed; the count on the icon moves with `onPosted`.
 */
function InlineComments({ postId, onPosted }: { postId: string; onPosted: () => void }) {
  const [page, setPage] = useState<CommentPage | null>(null);

  useEffect(() => {
    let alive = true;
    loadComments(postId).then((p) => { if (alive) setPage(p); });
    return () => { alive = false; };
  }, [postId]);

  return (
    <div className="mt-1 px-3 pb-2">
      <CommentThread
        postId={postId}
        page={page ?? { items: [], next_cursor: null }}
        embedded
        autoFocus
        loading={page === null}
        onPosted={() => {
          onPosted();
          loadComments(postId).then(setPage);
        }}
      />
    </div>
  );
}

/**
 * The "…" menu on your own post: edit the caption, download the photo as a
 * story, or delete. Closes on an outside click or Escape; not a modal, so it
 * traps nothing.
 */
function PostMenu({ pending, onEdit, onDelete, onStory, storyBusy = false }: {
  pending: boolean;
  onEdit: () => void;
  onDelete?: () => void;
  onStory?: () => void;
  storyBusy?: boolean;
}) {
  const { t } = useI18n();
  const s = t.common.social;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const canShare = useCanShareFiles();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex w-full items-center rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold disabled:opacity-50";
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-label={s.postOptions}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-10 w-10 place-items-center rounded-full text-ink-faint hover:bg-bg hover:text-ink"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-[calc(100%+4px)] z-20 w-44 rounded-2xl border border-line bg-surface p-1 shadow-lg">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onEdit(); }} className={`${item} text-ink hover:bg-bg`}>
            {s.editPost}
          </button>
          {onStory ? (
            <button type="button" role="menuitem" disabled={storyBusy} onClick={() => { setOpen(false); onStory(); }} className={`${item} text-ink hover:bg-bg`}>
              {storyBusy ? t.common.actions.loading : canShare ? s.shareStory : s.downloadStory}
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => { setOpen(false); onDelete(); }}
              className={`${item} text-risk hover:bg-risk-soft`}
            >
              {s.deletePost}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------- save ----------

/**
 * The bookmark: optimistic, one request at a time, rolled back on failure —
 * the state machine is saveReducer (lib/post-share.ts, tested). It asks the
 * server for a state, not a flip, so a retry lands where the tap meant.
 * Unsaving refreshes the page, which is what takes the post off /saved.
 */
function useSave(post: FeedPost) {
  const router = useRouter();
  const [state, dispatch] = useReducer(saveReducer, { saved: post.saved, pending: false, error: false });
  // A refresh brings the server's value; it never overrides a request in flight.
  useEffect(() => dispatch({ type: "sync", saved: post.saved }), [post.saved]);

  function toggle() {
    if (state.pending) return;
    const next = !state.saved;
    dispatch({ type: "tap" });
    setPostSaved(post.id, next)
      .then((r) => {
        dispatch({ type: "done", ok: r.ok });
        if (r.ok && !next) router.refresh();
      })
      .catch(() => dispatch({ type: "done", ok: false }));
  }
  return { ...state, toggle };
}

type SaveApi = ReturnType<typeof useSave>;

// ---------- share ----------

/**
 * The share sheet: Copy link, Share to Voinic, and the system share sheet
 * where the browser has one. A bottom sheet on a phone, a dialog from `sm`;
 * Escape, the close button and a tap outside all close it, and focus returns
 * to the Share button (native <dialog>).
 *
 * The link is this post's own page on this site's origin, built from the
 * server's id — never from anything typed. Share to Voinic sends only the
 * post's id; the database decides whether it may be shared and what the
 * share points at (see sharePost).
 */
function ShareSheet({ post, onClose }: { post: FeedPost; onClose: () => void }) {
  const { t } = useI18n();
  const s = t.common.social;
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [url] = useState(() => postShareUrl(window.location.origin, post.id));
  const [webShare] = useState(() => (url ? canWebShare(navigator, url) : false));
  const targets = shareTargets({ webShare, canRepost: canRepost(post) });
  const [status, setStatus] = useState<"copied" | "copyFailed" | "shared" | null>(null);
  const [composing, setComposing] = useState(false);
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("followers");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("copyFailed");
    }
  }

  async function external() {
    if (!url) return;
    try {
      await navigator.share({ url });
    } catch {
      // Cancelled or refused: the sheet stays, Copy link is still there.
    }
  }

  const row = "flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[14px] font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
  return (
    <dialog
      ref={ref}
      aria-label={s.shareTitle}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}
      className="app-dialog sheet-enter mb-0 mt-auto w-full max-w-none rounded-t-3xl bg-surface p-0 text-ink sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-sm sm:rounded-3xl"
    >
      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="font-display text-lg font-bold tracking-tight">{s.shareTitle}</p>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label={t.common.actions.close}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-bg hover:text-ink"
          >
            <NavIcon d={CLOSE} className="h-5 w-5" />
          </button>
        </div>

        {composing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const r = await sharePost(post.id, caption, visibility);
                if (!r.ok) { setError(r.message ?? s.shareFailed); return; }
                setComposing(false);
                setStatus("shared");
                router.refresh();
              });
            }}
          >
            <textarea
              autoFocus
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, POST_TEXT_MAX))}
              maxLength={POST_TEXT_MAX}
              rows={3}
              placeholder={s.shareCaption}
              aria-label={s.shareCaption}
              className="w-full resize-none rounded-2xl border border-line bg-bg px-3.5 py-3 text-[15px] outline-none focus:border-accent"
            />
            <div className="mt-2">
              <VisibilityPicker value={visibility} onChange={setVisibility} />
            </div>
            {error ? <p role="status" className="mt-2 text-[12.5px] text-risk">{error}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setComposing(false)} className="h-11 rounded-2xl px-4 text-[13px] font-semibold text-ink-soft hover:bg-bg hover:text-ink">
                {s.cancel}
              </button>
              <button type="submit" disabled={pending} className="h-11 rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50">
                {s.shareConfirm}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-1">
            {targets.includes("copy") ? (
              <button type="button" onClick={copy} disabled={!url} className={row}>
                <NavIcon d={status === "copied" ? CHECK : LINK} className={`h-5 w-5 ${status === "copied" ? "text-accent-ink" : ""}`} />
                {status === "copied" ? s.linkCopied : s.copyLink}
              </button>
            ) : null}
            {targets.includes("voinic") ? (
              <button type="button" onClick={() => { setStatus(null); setComposing(true); }} disabled={status === "shared"} className={row}>
                <NavIcon d={status === "shared" ? CHECK : REPOST} className={`h-5 w-5 ${status === "shared" ? "text-accent-ink" : ""}`} />
                <span className="min-w-0">
                  <span className="block">{status === "shared" ? s.shared : s.shareToVoinic}</span>
                  {status === "shared" ? null : (
                    <span className="block text-[12px] font-normal text-ink-faint">{s.shareToVoinicHint}</span>
                  )}
                </span>
              </button>
            ) : null}
            {targets.includes("external") ? (
              <button type="button" onClick={external} className={row}>
                <NavIcon d={EXTERNAL} className="h-5 w-5" />
                {s.shareExternally}
              </button>
            ) : null}
            {status === "copyFailed" && url ? (
              // The clipboard said no (permissions, an old browser): the link
              // itself, selected, so it can be copied by hand.
              <div className="mt-1 px-1">
                <p className="text-[12.5px] text-ink-soft">{s.copyFailed}</p>
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={s.copyLink}
                  className="mt-1.5 h-11 w-full rounded-xl border border-line bg-bg px-3 text-[13px] outline-none focus:border-accent"
                />
              </div>
            ) : null}
          </div>
        )}
        <p role="status" className="sr-only">
          {status === "copied" ? s.linkCopied : status === "shared" ? s.shared : ""}
        </p>
      </div>
    </dialog>
  );
}

/**
 * The original inside a share, exactly as the server returned it for this
 * reader — or, when it returned nothing (deleted, hidden from them, author
 * suspended), a plain "Original post unavailable". Nothing of the original
 * is ever kept on the share itself, so nothing can be shown that its author
 * has since taken back.
 */
function SharedEmbed({ post }: { post: FeedPost }) {
  const { t } = useI18n();
  const s = t.common.social;
  const o = post.shared;
  if (!o) {
    return (
      <div className="mx-4 flex items-center gap-3 rounded-2xl border border-dashed border-line bg-bg px-4 py-5">
        <NavIcon d={UNAVAILABLE} className="h-6 w-6 text-ink-faint" />
        <div className="min-w-0">
          <p className="text-[14px] font-semibold">{s.originalUnavailable}</p>
          <p className="mt-0.5 text-[12.5px] text-ink-faint">{s.originalUnavailableHint}</p>
        </div>
      </div>
    );
  }
  // The original, in the shape PostMedia reads; none of its counts are shown here.
  const inner: FeedPost = {
    ...o, activity_id: null, challenge_id: null, kudos_count: 0, love_count: 0, comment_count: 0, my_reaction: null, media: o.media ?? [],
    kudos_names: [], edited_at: null, mine: false, saved: false, shared: null, comment_preview: [], author_muted: false,
  };
  return (
    <div className="mx-4 overflow-hidden rounded-2xl border border-line">
      <Link
        href={`/feed/${o.id}`}
        aria-label={fill(s.sharedFrom, { name: o.author_name })}
        className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-bg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <Avatar name={o.author_name} url={o.author_avatar} size="h-7 w-7" />
        <span className="min-w-0 flex-1 truncate">
          <span className={SOCIAL.text.name}>{o.author_name}</span>
          {o.type !== "text" ? <span className={`ml-2 ${SOCIAL.text.meta}`}>{s.postKind[o.type]}</span> : null}
        </span>
      </Link>
      <PostMedia post={inner} splash={null} />
      {o.text ? (
        <MentionText
          text={o.text}
          mentions={o.mentions}
          hashtags
          className="line-clamp-4 whitespace-pre-wrap break-words px-3.5 py-2.5 text-[14px] leading-[1.45]"
        />
      ) : null}
    </div>
  );
}

// ---------- reactions ----------

/** The gold sparks that fly out of a button when a reaction is given. */
function Sparks({ at }: { at: number }) {
  return (
    <span key={at} className="reaction-burst" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} style={{ "--angle": `${i * 45}deg` } as React.CSSProperties} />
      ))}
    </span>
  );
}

/**
 * The action row: the arm and the peach, each with its count, then the
 * comments control the card passes in; under it the "Norbert, Maria and 3
 * others reacted" line, which opens the list of who pressed what. The state
 * is the card's (useReactions), so a double-tap on the photo and a press on
 * the row are the same flip.
 */
function Reactions({ post, reactions, comments, extra }: {
  post: FeedPost;
  reactions: ReturnType<typeof useReactions>;
  comments: React.ReactNode;
  /** Share and Save, after the comments control. */
  extra?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [listOpen, setListOpen] = useState(false);
  // Which press has finished popping, so the class comes off and the next
  // press restarts the animation without remounting the picture (a remount blinks).
  const [popped, setPopped] = useState<string | null>(null);
  const s = t.common.social;
  const { state, press, error, burst } = reactions;
  const total = state.kudos_count + state.love_count;

  // The names travel with the row; when the viewer's own press is in flight
  // the count moves but the names do not — kudosSummary keeps them consistent.
  const summary = kudosSummary(total, post.kudos_names);
  const line = (() => {
    const { first, second, others } = summary;
    if (first === null) return null;
    if (second === null) {
      if (others === 0) return fill(s.kudosByOne, { name: first });
      if (others === 1) return fill(s.kudosByOneAndOne, { name: first });
      return fill(s.kudosByOneAndOthers, { name: first, others });
    }
    if (others === 0) return fill(s.kudosByTwo, { name: first, second });
    if (others === 1) return fill(s.kudosByThree, { name: first, second });
    return fill(s.kudosBy, { name: first, second, others });
  })();

  const openList = () => { if (total > 0) setListOpen(true); };

  const button = (type: ReactionType) => {
    const count = type === "kudos" ? state.kudos_count : state.love_count;
    const on = state.my_reaction === type;
    const popKey = burst ? `${burst.at}:${burst.type}` : null;
    const popping = burst?.type === type && popped !== popKey;
    const countEl = <span className="text-[14px] tabular-nums">{count}</span>;
    if (post.mine) {
      // Own post: nothing to give, so the pill opens the list instead.
      return (
        <button
          type="button"
          onClick={openList}
          disabled={total === 0}
          aria-label={`${s.reactionLabel[type]}: ${count}`}
          title={s.seeReactions}
          className="inline-flex h-10 items-center gap-1.5 rounded-full px-2.5 font-semibold text-ink-soft enabled:cursor-pointer enabled:hover:bg-bg enabled:hover:text-ink"
        >
          <ReactionIcon type={type} className="h-[26px] w-[26px]" muted={count === 0} />
          {countEl}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => press(type)}
        aria-pressed={on}
        aria-label={on ? s.removeReaction : s.giveReaction[type]}
        title={s.giveReaction[type]}
        className={`relative inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-2.5 font-semibold transition-colors ${
          on ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-bg hover:text-ink"
        }`}
      >
        <span className="relative grid place-items-center">
          <span
            className={`grid place-items-center ${popping ? "reaction-pop" : ""}`}
            onAnimationEnd={(e) => { if (e.animationName === "reaction-pop") setPopped(popKey); }}
          >
            <ReactionIcon type={type} className="h-[26px] w-[26px]" muted={!on} />
          </span>
          {popping ? <Sparks at={burst!.at} /> : null}
        </span>
        {countEl}
      </button>
    );
  };

  return (
    <div className="mt-3 px-3">
      <div className="flex items-center gap-0.5">
        {button("kudos")}
        {button("love")}
        {comments}
        {extra}
      </div>
      {line ? (
        <button
          type="button"
          onClick={openList}
          className="mt-0.5 block max-w-full cursor-pointer truncate px-2.5 text-left text-[13px] text-ink-soft hover:text-ink"
        >
          {fill(summary.second === null && summary.others === 0 ? s.reactionsFromOne : s.reactionsFrom, { names: line })}
        </button>
      ) : null}
      {error ? <p role="status" className="mt-1 px-2.5 text-[11px] text-risk">{error}</p> : null}
      {listOpen ? <KudosDialog postId={post.id} onClose={() => setListOpen(false)} /> : null}
    </div>
  );
}


/** Who reacted, and how — a native <dialog>, first page on open, "Load more" for the rest. */
function KudosDialog({ postId, onClose }: { postId: string; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<KudosGiver[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const s = t.common.social;

  useEffect(() => {
    ref.current?.showModal();
    let alive = true;
    loadKudos(postId).then((page) => {
      if (!alive) return;
      setItems(page.items);
      setCursor(page.next_cursor);
    });
    return () => { alive = false; };
  }, [postId]);

  function more() {
    if (!cursor) return;
    startTransition(async () => {
      const page = await loadKudos(postId, cursor);
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setCursor(page.next_cursor);
    });
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); ref.current?.close(); } }}
      aria-label={s.reactions}
      className="app-dialog m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl bg-surface p-0 text-ink"
    >
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
            <ReactionIcon type="kudos" className="h-[22px] w-[22px]" />
            {s.reactions}
          </p>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label={t.common.actions.close}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg text-ink-soft hover:text-ink"
          >
            <NavIcon d={CLOSE} className="h-4 w-4 [stroke-width:2.2]" />
          </button>
        </div>
        {items === null ? (
          <p className="py-6 text-center text-sm text-ink-faint">{t.common.actions.loading}</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint">{s.noReactionsYet}</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-line/60 overflow-y-auto">
            {items.map((k) => (
              <li key={k.user_id}>
                <Link href={`/people/${k.user_id}`} className="flex min-h-12 items-center gap-3 rounded-xl px-1 hover:bg-bg">
                  <Avatar name={k.name} url={k.avatar_url} size="h-9 w-9" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{k.name}</span>
                  <ReactionIcon type={k.type} className="h-6 w-6" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {cursor ? (
          <button
            type="button"
            onClick={more}
            disabled={pending}
            className="mt-4 flex h-11 w-full items-center justify-center rounded-2xl bg-bg text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
          >
            {s.loadMore}
          </button>
        ) : null}
      </div>
    </dialog>
  );
}

// ---------- comments ----------
// The conversation lives in components/comment-thread.tsx: replies, mentions
// and its own composer. It was moved out of this file when replies arrived —
// two comment lists with different capabilities is the thing to avoid.

// ---------- composer ----------

/**
 * Collapsed, it is one row — avatar and a "share something…" pill, the way
 * the big feeds do it; a tap opens the real form (text, who can see it, the
 * progress opt-in) in place. `me` is the signed-in reader, for the avatar.
 */
export function Composer({ me, photoUploads = false }: { me?: { name: string; avatar_url: string | null }; photoUploads?: boolean }) {
  const { t } = useI18n();
  const u = useUnits();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [progress, setProgress] = useState(false);
  const [includeWeight, setIncludeWeight] = useState(false);
  const [weight, setWeight] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("followers");
  const [overlay, setOverlay] = useState<PhotoOverlay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const media = useMediaDraft();
  const mention = useMentionSuggest(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const s = t.common.social;
  const items = media.draft.items;
  // The author's overlay (relu19's editor) is for one picture on its own.
  const single = items.length === 1 && items[0]!.status === "ready" ? items[0]! : null;
  const busy = draftBusy(media.draft);

  // One file input for both states: "Photo" on the collapsed row opens the
  // composer and the picker in the same tap.
  const picker = photoUploads ? (
    <input
      ref={fileRef}
      type="file"
      accept={MEDIA_ACCEPT}
      multiple
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length === 0) return;
        setOpen(true);
        setError(null);
        if (files.length > 0 && items.length === 0) setOverlay(null);
        void media.pick(files);
      }}
    />
  ) : null;

  function close() {
    media.discardAll();
    setOverlay(null);
    setError(null);
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-2.5 pl-3">
        {picker}
        <div className="flex items-center gap-3">
          {me ? <Avatar name={me.name} url={me.avatar_url} size={SOCIAL.avatar.composer} /> : null}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-11 min-w-0 flex-1 truncate rounded-full bg-bg px-4 text-left text-[14.5px] text-ink-faint transition-colors hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {s.composerPrompt}
          </button>
          {photoUploads ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label={s.mediaAddMore}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-bg hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <NavIcon d={CAMERA} className="h-[20px] w-[20px] text-accent-ink" />
              <span className="hidden sm:inline">{s.mediaPhoto}</span>
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      {picker}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const plan = publishPlan(media.draft, text);
          if (!plan.ok) {
            setError(plan.reason === "busy" ? s.mediaWaitUploads : plan.reason === "failed" ? s.mediaFixFailed : s.textInvalid);
            return;
          }
          const withOverlay = plan.media.length === 1 && overlay ? [{ ...plan.media[0]!, overlay }] : plan.media;
          startTransition(async () => {
            const r = progress
              // The box is in the reader's unit; social_posts stores kilograms
              // like every other weight, so the feed cannot mix the two.
              ? await createProgressPost(
                  text,
                  visibility,
                  includeWeight ? displayToKg(Number(weight.replace(",", ".")), u.weightUnit) : null,
                  withOverlay,
                )
              : await createTextPost(text, visibility, withOverlay);
            if (!r.ok) {
              // The draft stays as it is — pictures included — so a retry is one tap.
              setError(r.message ?? s.mediaPublishFailed);
              return;
            }
            media.markPublished();
            setText(""); setWeight(""); setIncludeWeight(false); setProgress(false); setOverlay(null); setOpen(false); mention.clear();
            router.refresh();
          });
        }}
      >
        {/* Above the box, so the on-screen keyboard does not cover it. */}
        <MentionSuggestions
          people={mention.suggestions}
          onPick={(person) => {
            const caret = box.current?.selectionStart ?? text.length;
            const next = mention.choose(text, caret, person);
            if (!next) return;
            setText(next.body.slice(0, POST_TEXT_MAX));
            requestAnimationFrame(() => {
              box.current?.focus();
              box.current?.setSelectionRange(next.caret, next.caret);
            });
          }}
        />
        <div className="flex items-start gap-3">
          {me ? <Avatar name={me.name} url={me.avatar_url} size="h-10 w-10" /> : null}
          <textarea
            ref={box}
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value.slice(0, POST_TEXT_MAX));
              mention.track(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyUp={(e) => mention.track(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            onClick={(e) => mention.track(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            placeholder={s.composerPrompt}
            aria-label={s.composerPlaceholder}
            maxLength={POST_TEXT_MAX}
            rows={3}
            className="min-w-0 flex-1 resize-none rounded-2xl border border-line bg-bg px-3.5 py-3 text-[15px] outline-none focus:border-accent"
          />
        </div>
        {photoUploads && items.length > 0 ? (
          <div className="mt-3 space-y-3">
            <MediaTray api={media} disabled={pending} onAddMore={() => fileRef.current?.click()} />
            {single?.previewUrl && single.width && single.height ? (
              // Only text goes on a photo here; the workout's figures belong to
              // a workout post (the share panel after a session).
              <PhotoOverlayEditor
                src={single.previewUrl}
                width={single.width}
                height={single.height}
                stats={null}
                value={overlay}
                onChange={setOverlay}
                disabled={pending}
              />
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {photoUploads ? (
              <button
                type="button"
                disabled={pending || items.length >= POST_MEDIA_MAX}
                onClick={() => fileRef.current?.click()}
                aria-label={s.mediaAddMore}
                className="inline-flex h-11 items-center gap-2 rounded-2xl bg-bg px-3.5 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <NavIcon d={CAMERA} className="h-[18px] w-[18px] text-accent-ink" />
                {s.mediaPhoto}
              </button>
            ) : null}
            <VisibilityPicker value={visibility} onChange={setVisibility} />
          </div>
          <span className="text-[11px] tabular-nums text-ink-faint">{text.length}/{POST_TEXT_MAX}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[12.5px]">
          <label className="inline-flex min-h-11 items-center gap-2 font-semibold text-ink-soft">
            <input type="checkbox" checked={progress} onChange={(e) => setProgress(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
            <NavIcon d={TREND} className="h-4 w-4 text-ink-faint" />
            {s.progressUpdate}
          </label>
          {progress ? (
            <label className="inline-flex min-h-11 items-center gap-2 font-semibold text-ink-soft">
              <input type="checkbox" checked={includeWeight} onChange={(e) => setIncludeWeight(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
              {s.progressWeightOptIn}
              {includeWeight ? (
                <input
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  inputMode="decimal"
                  placeholder={u.weightUnit}
                  className="h-9 w-20 rounded-xl border border-line bg-bg px-2.5 text-sm tabular-nums outline-none focus:border-accent"
                />
              ) : null}
            </label>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={close}
              className="h-11 rounded-2xl px-4 font-semibold text-ink-faint hover:bg-bg hover:text-ink"
            >
              {s.cancel}
            </button>
            <button
              type="submit"
              // Words or a picture: either one is a post — once every picture is up.
              disabled={pending || busy || (text.trim().length === 0 && items.length === 0)}
              aria-busy={pending || busy}
              className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              {pending ? t.common.actions.loading : s.post}
            </button>
          </div>
        </div>
        {error ? <p role="alert" className="mt-2 text-xs text-risk">{error}</p> : null}
      </form>
    </div>
  );
}

// ---------- follow ----------

/**
 * Follow / Follow back / Following, from the two real edges the server read
 * returned (never guessed on the client). The relationship itself — "Follows
 * you", "Mutual" — is said beside it, not on it.
 *
 * Follow is one tap and optimistic. Unfollow takes a second tap: the first
 * turns the button into "Unfollow" for a few seconds, so a stray thumb on a
 * list does not quietly cut a connection. While a request is out the button
 * is disabled, so a double tap cannot send two; the actions are idempotent
 * anyway (an upsert, and a delete that treats "already gone" as done). On a
 * failure the optimistic state falls back to what the server last said, and
 * the button says why in its title and to screen readers.
 *
 * The width is fixed per size, so no label change moves anything around it.
 */
export function FollowButton({ userId, following, followsMe = false, compact = false }: {
  userId: string;
  following: boolean;
  followsMe?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useOptimistic(following, (_, next: boolean) => next);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = t.common.social;

  // The unfollow prompt lapses on its own.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(id);
  }, [confirming]);

  const look = followButtonState({ is_following: state, follows_me: followsMe });
  const label = confirming ? s.unfollow : look === "following" ? s.following : look === "follow_back" ? s.followBack : s.follow;

  function send(next: boolean) {
    setConfirming(false);
    setError(null);
    startTransition(async () => {
      setState(next);
      const r = await (next ? follow(userId) : unfollow(userId));
      if (!r.ok) {
        setError(r.message ?? s.followError);
        return; // no refresh: the optimistic state drops back to the server's
      }
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-pressed={state}
        title={error ?? undefined}
        onClick={() => {
          if (!state) send(true);
          else if (confirming) send(false);
          else setConfirming(true);
        }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold transition-colors duration-150 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          confirming
            ? "bg-risk-soft text-risk"
            : state
              ? "border border-line bg-surface text-ink hover:bg-bg"
              : "bg-accent text-accent-fg hover:opacity-90"
        } ${error ? "ring-2 ring-risk/60" : ""} ${
          compact ? "h-9 min-w-[104px] px-3.5 text-[12.5px]" : "h-10 min-w-[136px] px-5 text-[13.5px]"
        }`}
      >
        {label}
      </button>
      <span role="status" className="sr-only">{error ?? ""}</span>
    </>
  );
}

// ---------- share panel (workout done) ----------

/** An uploaded post photo as the browser holds it: Cloudinary's handle, the pixel size it sent, a preview. */
function photoInput(photo: PostPhoto | null, overlay: PhotoOverlay | null): PostPhotoInput | null {
  return photo ? { publicId: photo.publicId, version: photo.version, width: photo.width, height: photo.height, overlay } : null;
}

/**
 * Whether this browser can hand a JPEG to the native share sheet — phones
 * can, and that sheet is where Instagram (Story, Feed) and Facebook live;
 * there is no web API that opens Instagram with a picture ready to post, so
 * the sheet IS the share button. Desktops get a download instead, and the
 * label says which it will be.
 */
function useCanShareFiles(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    try {
      setCan(canShareFile(new File([new Uint8Array(4)], "story.jpg", { type: "image/jpeg" })));
    } catch {
      setCan(false);
    }
  }, []);
  return can;
}

/**
 * "Share to Instagram, Facebook…" on a phone, "Download for Story" on a
 * desktop: the photo with its overlay at 1080×1920 and the mark in the
 * corner, through the native share sheet where there is one, saved as a file
 * otherwise. Works before and after the post goes out — the picture is
 * already on Cloudinary either way.
 */
function StoryDownload({ photo, overlay, stats, title, date }: {
  photo: PostPhoto;
  overlay: PhotoOverlay | null;
  stats: OverlayStatValues;
  title: string;
  date: string;
}) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const s = t.common.social;
  const [status, setStatus] = useState<"idle" | "busy" | "ready" | "shared" | "failed">("idle");
  const canShare = useCanShareFiles();
  async function run() {
    setStatus("busy");
    try {
      const blob = await renderPhotoStory({
        photoUrl: photo.previewUrl, width: photo.width, height: photo.height, overlay, stats, brand: APP_NAME, tagline: APP_TAGLINE,
        workout: { kicker: s.workoutPost, name: title, date: f.day(date) },
      });
      const how = await deliverShareImage(blob, storyFileName(date), title);
      setStatus(how === "shared" ? "shared" : how === "saved" ? "ready" : "idle");
    } catch {
      setStatus("failed");
    }
  }
  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={status === "busy"}
        className="inline-flex h-11 items-center gap-2 rounded-2xl bg-bg px-4 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
      >
        <NavIcon d={canShare ? "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3m0 0-4 4m4-4 4 4" : "M12 4v11m0 0-4-4m4 4 4-4M5 19h14"} className="h-[18px] w-[18px]" />
        {status === "busy" ? t.common.actions.loading : canShare ? s.shareStory : s.downloadStory}
      </button>
      {status === "ready" || status === "shared" || status === "failed" ? (
        <p role="status" className={`mt-1.5 text-[12px] ${status === "failed" ? "text-risk" : "text-accent-ink"}`}>
          {status === "failed" ? s.storyFailed : status === "shared" ? s.storyShared : s.storyReady}
        </p>
      ) : null}
    </div>
  );
}

export function SharePanel({ session, onShare, onSharePr, photoUploads = false }: {
  session: ShareableSession;
  onShare: (visibility: PostVisibility, text: string, photo: PostPhotoInput | null) => Promise<{ ok: boolean; message?: string }>;
  onSharePr: (setId: string, visibility: PostVisibility) => Promise<{ ok: boolean; message?: string }>;
  /** Whether Cloudinary is configured; without it the photo button is not offered. */
  photoUploads?: boolean;
}) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [visibility, setVisibility] = useState<PostVisibility>("followers");
  const [text, setText] = useState("");
  const [shared, setShared] = useState(session.already_shared);
  const [photo, setPhoto] = useState<PostPhoto | null>(null);
  const [overlay, setOverlay] = useState<PhotoOverlay | null>(null);
  const [sharedPrs, setSharedPrs] = useState<Set<string>>(new Set(session.prs.filter((p) => p.shared).map((p) => p.set_id)));
  const [error, setError] = useState<string | null>(null);
  const s = t.common.social;
  const overlayStats = useOverlayStats({ ...session, prs: session.prs.length });

  return (
    <div className="space-y-4">
      <Card plain>
        <p className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight">
          <NavIcon d={DUMBBELL} className="h-[21px] w-[21px] text-accent" />
          <span className="min-w-0 truncate">{session.name}</span>
        </p>
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] tabular-nums text-ink-faint">
          {f.duration(session.duration_min) ? <span>{f.duration(session.duration_min)}</span> : null}
          <span>{fill(s.exercisesCount, { count: session.exercises })}</span>
          <span>{fill(s.setsCount, { count: session.sets })}</span>
          <span>{fill(s.volume, { kg: f.n(session.volume_kg) })}</span>
        </p>
        <p className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold text-accent-ink">
          <NavIcon d={FLAME} className="h-[17px] w-[17px]" />
          {fill(s.trainingLoad, { load: session.load })}
        </p>
        {!shared ? (
          <div className="mt-4 space-y-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, POST_TEXT_MAX))}
              placeholder={s.composerPlaceholder}
              className="h-11 w-full rounded-xl border border-line bg-bg px-3.5 text-sm outline-none focus:border-accent"
            />
            {photoUploads ? <PhotoPicker photo={photo} onChange={(next) => { setPhoto(next); setOverlay(null); }} disabled={pending} /> : null}
            {photo ? (
              <PhotoOverlayEditor
                src={photo.previewUrl}
                width={photo.width}
                height={photo.height}
                stats={overlayStats}
                value={overlay}
                onChange={setOverlay}
                disabled={pending}
              />
            ) : null}
            <VisibilityPicker value={visibility} onChange={setVisibility} />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const r = await onShare(visibility, text, photoInput(photo, overlay));
                    if (!r.ok) setError(r.message ?? "Error");
                    else setShared(true);
                    router.refresh();
                  })
                }
                className="flex h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50 sm:w-auto"
              >
                {s.shareToFeed}
              </button>
              {photo ? <StoryDownload photo={photo} overlay={overlay} stats={overlayStats} title={session.name} date={session.date} /> : null}
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-accent-ink">
              <NavIcon d={CHECK} className="h-4 w-4 [stroke-width:2.4]" />
              {s.shared}
            </p>
            {photo ? <StoryDownload photo={photo} overlay={overlay} stats={overlayStats} title={session.name} date={session.date} /> : null}
          </div>
        )}
        {error ? <p className="mt-2 text-xs text-risk">{error}</p> : null}
      </Card>

      {session.prs.length > 0 ? (
        <Card plain>
          <BlockLabel icon={TROPHY}>{s.newPr}</BlockLabel>
          <ul className="mt-2.5 divide-y divide-line/60">
            {session.prs.map((pr) => (
              <li key={pr.set_id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{pr.exercise}</p>
                  <p className="mt-0.5 text-[12.5px] tabular-nums text-ink-faint">{f.n(pr.weight_kg)} kg × {pr.reps}</p>
                </div>
                {sharedPrs.has(pr.set_id) ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-accent-ink">
                    <NavIcon d={CHECK} className="h-4 w-4 [stroke-width:2.4]" />
                    {s.prShared}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await onSharePr(pr.set_id, visibility);
                        if (r.ok) setSharedPrs((prev) => new Set([...prev, pr.set_id]));
                        else setError(r.message ?? "Error");
                        router.refresh();
                      })
                    }
                    className="inline-flex h-9 shrink-0 items-center rounded-full bg-bg px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
                  >
                    {s.sharePr}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}


/**
 * How big a file the picker accepts. Generous, because the browser shrinks
 * it (lib/image-prepare.ts) before anything is sent: what leaves the phone
 * is a JPEG no wider than 1600px, typically 200–400 KB.
 */
const POST_PHOTO_MAX_BYTES = 25 * 1024 * 1024;

/**
 * "Add a photo" for a post — the gym selfie.
 *
 * `capture="environment"` is deliberately *not* set: on a phone the picker
 * offers both the camera and the library, and someone who wants a selfie wants
 * the front camera, which only the unhinted picker lets them choose. The file
 * is resized and cropped on the device (preparePhoto), then goes straight to
 * Cloudinary under a signature this server minted (requestPostPhotoUpload),
 * so it never passes through a server action body; the post only carries the
 * public_id, version and pixel size — the URL itself is rebuilt server-side
 * when the post is written.
 */
function PhotoPicker({ photo, onChange, disabled }: {
  photo: PostPhoto | null;
  onChange: (photo: PostPhoto | null) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const s = t.common.social;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"idle" | "preparing" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) { setError(s.photoNotImage); return; }
    if (file.size > POST_PHOTO_MAX_BYTES) { setError(s.photoTooLarge); return; }
    setBusy("preparing");
    let preview: string | null = null;
    try {
      const prepared = await preparePhoto(file);
      preview = prepared.previewUrl;
      setBusy("uploading");
      const permission = await requestPostPhotoUpload();
      if (!permission.ok || !permission.ticket) { setError(permission.message ?? s.photoFailed); return; }
      const ticket = permission.ticket;
      const body = new FormData();
      body.append("file", prepared.blob, "photo.jpg");
      body.append("api_key", ticket.apiKey);
      for (const [key, value] of Object.entries(ticket.fields)) body.append(key, value);
      const response = await fetch(`https://api.cloudinary.com/v1_1/${ticket.cloudName}/image/upload`, { method: "POST", body });
      if (!response.ok) { setError(s.photoFailed); return; }
      const uploaded = (await response.json()) as { public_id?: string; version?: number; secure_url?: string };
      if (!uploaded.public_id || !uploaded.version) { setError(s.photoFailed); return; }
      // The preview stays the local object URL (instant, no second download);
      // the story export loads Cloudinary's copy when there is one, since a
      // canvas can only draw a same-origin or CORS-served image.
      onChange({
        publicId: uploaded.public_id,
        version: uploaded.version,
        width: prepared.width,
        height: prepared.height,
        previewUrl: uploaded.secure_url ?? prepared.previewUrl,
      });
      if (uploaded.secure_url) URL.revokeObjectURL(prepared.previewUrl);
      preview = null;
    } catch {
      setError(s.photoFailed);
    } finally {
      if (preview) URL.revokeObjectURL(preview);
      setBusy("idle");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
      />
      {photo ? (
        <div className="flex items-center gap-3">
          <span className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-bg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.previewUrl} alt="" aria-hidden className="h-full w-full object-cover" />
          </span>
          <button
            type="button"
            disabled={disabled || busy !== "idle"}
            onClick={() => onChange(null)}
            className="inline-flex h-10 items-center rounded-2xl px-3.5 text-[13px] font-semibold text-ink-faint hover:bg-bg hover:text-risk disabled:opacity-50"
          >
            {s.photoRemove}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || busy !== "idle"}
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-bg px-4 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
        >
          <NavIcon d="M4 8h3l1.5-2h7L17 8h3v11H4zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7" className="h-[18px] w-[18px]" />
          {busy === "preparing" ? s.photoPreparing : busy === "uploading" ? t.common.actions.loading : s.photoAdd}
        </button>
      )}
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">{s.photoHint}</p>
      {error ? <p className="mt-1 text-[12.5px] text-risk">{error}</p> : null}
    </div>
  );
}

