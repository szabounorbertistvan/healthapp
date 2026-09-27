"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useReducer, useRef, useState, useTransition } from "react";
import type { PostVisibility } from "@healthapp/shared";
import { displayToKg, followButtonState, isAchievementRarity, toggleKudosState, POST_TEXT_MAX } from "@healthapp/shared";
import {
  createProgressPost, createTextPost, deletePost, editPost, follow, loadKudos, requestPostPhotoUpload, setPostSaved, sharePost,
  toggleKudos, unfollow,
} from "@/app/social-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { parseDay } from "@/lib/week";
import { durationLabel } from "@/lib/share-card";
import type { FeedPost, KudosGiver, ShareableSession } from "@/lib/types";
import { NavIcon } from "./client-nav";
import { Card } from "./ui";
import { SOCIAL } from "@/lib/social-ui";
import { captionFolds, doubleTapGives, giveNeedsUndo, isDoubleTap, postAge } from "@/lib/post-card";
import { canRepost, canWebShare, postShareUrl, saveReducer, shareTargets } from "@/lib/post-share";
import { BadgeGlyph, MentionSuggestions, MentionText, useMentionSuggest } from "./social-v2";
import { CommentPreview } from "./comment-preview";
import { ModerationMenuButton } from "./moderation";

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

type FrameTone = "gold" | "tile" | "plain";
const FRAME_TONE: Record<FrameTone, string> = {
  gold: "bg-accent text-accent-fg",
  tile: "bg-tile text-tile-ink",
  plain: "bg-bg text-ink",
};

/**
 * The media slot every snapshot post shares: flush to the card's edges, one
 * 4:3 ratio for all of them, so a feed of mixed posts keeps one rhythm. The
 * ratio is a floor, not a clamp — `aspect-ratio` lets the box grow when its
 * content needs more room (a four-figure workout on a 320px phone), so
 * nothing is ever cut off. Eyebrow at the top, the headline at the bottom.
 */
function MediaFrame({ tone, eyebrow, children }: { tone: FrameTone; eyebrow: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`flex aspect-[4/3] flex-col justify-between gap-4 px-5 py-5 sm:px-6 ${FRAME_TONE[tone]}`}>
      {eyebrow}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Post photos at 4:5, cropped, never stretched. One photo is one frame; more
 * than one becomes a native scroll-snap carousel with a position counter —
 * today every post carries at most one, the shape is here for the ones that
 * will carry several. `overlay` sits on the first frame behind a scrim.
 */
function PhotoMedia({ urls, alt, overlay }: { urls: string[]; alt: string; overlay?: React.ReactNode }) {
  const { t } = useI18n();
  const [at, setAt] = useState(0);
  const many = urls.length > 1;
  return (
    <div className="relative bg-bg">
      <div
        className={many ? "snap-frames no-scrollbar" : undefined}
        onScroll={many ? (e) => setAt(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth)) : undefined}
      >
        {urls.map((url, i) => (
          <div key={url} className="relative aspect-[4/5]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={many ? `${alt} — ${fill(t.common.social.photoOf, { n: i + 1, total: urls.length })}` : alt}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
            {i === 0 && overlay ? overlay : null}
          </div>
        ))}
      </div>
      {many ? (
        <span aria-hidden className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11.5px] font-semibold tabular-nums text-white">
          {at + 1}/{urls.length}
        </span>
      ) : null}
    </div>
  );
}

/** Whether a post has a media slot at all. Text and progress posts do not. */
function hasMedia(post: FeedPost) {
  return post.payload !== null && post.payload.kind !== "progress";
}

/**
 * The post's media, where a photo would sit on Instagram. A workout photo is
 * the picture itself with the session written on it; without one, a workout
 * is the inverse tile with its figures large. The things somebody achieved —
 * a record, a finished challenge, a badge, a Fitness Score milestone, a
 * streak — are gold with the number as the hero. A shared routine is plain:
 * it is an invitation to train, not a result.
 */
function PostMedia({ post }: { post: FeedPost }) {
  const { t, locale } = useI18n();
  const f = useSocialFormat();
  const s = t.common.social;
  const p = post.payload;
  if (!p || p.kind === "progress") return null;

  const hero = "font-display text-[48px] font-black leading-none tracking-tight tabular-nums sm:text-[56px]";
  const title = "font-display text-[26px] font-extrabold leading-[1.1] tracking-tight sm:text-[28px]";
  const onGold = "text-accent-fg/70";

  if (p.kind === "workout") {
    const dur = f.duration(p.duration_min);
    const photo = typeof p.photo_url === "string" && p.photo_url.startsWith("https://") ? p.photo_url : null;
    const prChip = p.prs > 0 ? (
      <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-accent px-2.5 text-[11.5px] font-bold text-accent-fg">
        <NavIcon d={TROPHY} className="h-3.5 w-3.5 [stroke-width:2.2]" />
        {p.prs === 1 ? s.prOne : fill(s.prMany, { count: p.prs })}
      </span>
    ) : null;

    // With a photo, the picture is the post: the session is written on it
    // behind a scrim that is opaque at the bottom and clear at the top, so
    // white text reads on any photo and the picture is never dimmed where
    // nothing sits on it.
    if (photo) {
      return (
        <PhotoMedia
          urls={[photo]}
          alt={fill(s.photoAlt, { name: post.author_name })}
          overlay={
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-5 pb-4 pt-16 text-white">
              <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-white/70">
                <NavIcon d={DUMBBELL} className="h-3.5 w-3.5" />
                {s.workoutDone}
              </span>
              <p className="mt-1 truncate font-display text-[24px] font-extrabold leading-tight tracking-tight">{p.name}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-semibold tabular-nums text-white/85">
                {dur ? <span>{dur}</span> : null}
                <span>{fill(s.volume, { kg: f.n(p.volume_kg) })}</span>
                <span>{fill(s.setsCount, { count: p.sets })}</span>
                <span className="flex items-center gap-1">
                  <NavIcon d={FLAME} className="h-3.5 w-3.5" />
                  {fill(s.trainingLoad, { load: p.load })}
                </span>
                {prChip}
              </p>
            </div>
          }
        />
      );
    }

    return (
      <MediaFrame
        tone="tile"
        eyebrow={
          <div className="min-w-0">
            <BlockLabel icon={DUMBBELL} tone="text-tile-accent">{s.workoutDone}</BlockLabel>
            <p className={`mt-1.5 truncate ${title}`}>{p.name}</p>
          </div>
        }
      >
        <div className={`grid gap-3 ${dur ? "grid-cols-2 min-[400px]:grid-cols-4" : "grid-cols-3"}`}>
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
          {prChip}
        </div>
      </MediaFrame>
    );
  }

  if (p.kind === "pr") {
    return (
      <MediaFrame tone="gold" eyebrow={<BlockLabel icon={TROPHY} tone={onGold}>{s.newPr}</BlockLabel>}>
        <p className={hero}>
          {f.n(p.weight_kg)}
          <span className="ml-1 font-sans text-[17px] font-semibold opacity-70">kg</span>
          <span className="ml-2.5 font-sans text-[22px] font-bold opacity-80">× {p.reps}</span>
        </p>
        <p className="mt-3 text-[16px] font-semibold">{p.exercise}</p>
        <p className="mt-0.5 text-[12.5px] opacity-70">{s.personalBest}</p>
      </MediaFrame>
    );
  }
  if (p.kind === "challenge_completed") {
    return (
      <MediaFrame tone="gold" eyebrow={<BlockLabel icon={TROPHY} tone={onGold}>{s.challengeCompleted}</BlockLabel>}>
        <p className={title}>{locale === "ro" ? p.title_ro : p.title_en}</p>
        <p className="mt-2 text-[15px] font-semibold tabular-nums opacity-80">
          {f.n(p.value)} / {f.n(p.target)} {t.common.challenges.unit[p.type as keyof typeof t.common.challenges.unit] ?? ""}
        </p>
      </MediaFrame>
    );
  }
  // Everything on a shared routine comes from the snapshot taken when it was
  // posted, so editing the routine afterwards never rewrites the post — only
  // the link leads to today's version.
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
        className="block transition-colors hover:bg-accent-soft/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <MediaFrame tone="plain" eyebrow={<BlockLabel icon={DUMBBELL} tone="text-ink-faint">{r.sharedRoutine}</BlockLabel>}>
          <p className={title}>{p.name}</p>
          {p.description ? <p className="mt-1.5 line-clamp-2 text-[13.5px] text-ink-soft">{p.description}</p> : null}
          <p className="mt-2.5 text-[12.5px] tabular-nums text-ink-faint">{facts.join(" · ")}</p>
          {p.muscle_groups.length > 0 ? (
            <p className="mt-1 text-[12px] text-ink-faint">{p.muscle_groups.join(" · ")}</p>
          ) : null}
        </MediaFrame>
      </Link>
    );
  }
  // An earned badge: the name comes from the snapshot the database built from
  // the catalog when it was posted, never from the browser.
  if (p.kind === "achievement") {
    return (
      <MediaFrame tone="gold" eyebrow={<BlockLabel icon={TROPHY} tone={onGold}>{s.achievementPost}</BlockLabel>}>
        <span className="grid h-16 w-16 place-items-center rounded-full bg-accent-fg/15">
          <BadgeGlyph icon={p.icon} className="h-8 w-8 [stroke-width:2]" />
        </span>
        <p className={`mt-3.5 ${title}`}>{(locale === "ro" ? p.name_ro : p.name_en) ?? p.badge_slug}</p>
        {/* Rarity as the catalog had it when shared; older posts carry none. */}
        {isAchievementRarity(p.rarity) ? (
          <p className="mt-2 text-[11px] font-bold uppercase tracking-wider opacity-75">
            {t.common.achievements.rarities[p.rarity]}
          </p>
        ) : null}
      </MediaFrame>
    );
  }
  // A Fitness Score milestone: the score and the milestone it passed. Nothing
  // about the sessions behind it is in the snapshot, so nothing is shown.
  if (p.kind === "fitness_score") {
    return (
      <MediaFrame tone="gold" eyebrow={<BlockLabel icon={TREND} tone={onGold}>{s.fitnessScorePost}</BlockLabel>}>
        <p className={hero}>
          {p.score}
          <span className="ml-1.5 font-sans text-[17px] font-semibold opacity-70">/ 100</span>
        </p>
        <p className="mt-3 text-[16px] font-semibold">{fill(s.fitnessScoreReached, { milestone: p.milestone })}</p>
      </MediaFrame>
    );
  }
  if (p.kind !== "streak") return null;
  return (
    <MediaFrame tone="gold" eyebrow={<BlockLabel icon={FLAME} tone={onGold}>{t.common.streaks.title}</BlockLabel>}>
      <p className={hero}>
        {p.milestone}
        <span className="ml-2 font-sans text-[17px] font-semibold opacity-70">{t.common.streaks.days}</span>
      </p>
      <p className="mt-3 text-[16px] font-semibold">{fill(t.common.streaks.milestoneTitle, { count: p.milestone })}</p>
      <p className="mt-0.5 text-[12.5px] opacity-70">{fill(t.common.streaks.postBody, { count: p.streak_days })}</p>
    </MediaFrame>
  );
}

// ---------- kudos state ----------

/**
 * One post's Kudos, shared by the flame in the action row and the double tap
 * on the media, so both read and move the same state.
 *
 * The flip is optimistic: useOptimistic shows the new state at once and falls
 * back to the server's row when the transition ends, so a failed request rolls
 * back by itself — the only extra work is saying so, quietly. One request at a
 * time: while one is in flight, a second tap or double tap does nothing.
 * The count is always the server's (`kudos_count`, a count(*) in social_feed)
 * moved by one for the viewer's own flip; nothing is counted in the browser.
 */
function useKudos(post: FeedPost) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // True only between a give and the end of its pop: an already-given flame
  // arriving with the page stays still.
  const [pop, setPop] = useState(false);
  const s = t.common.social;
  const [state, flip] = useOptimistic<{ my_kudos: boolean; kudos_count: number }, void>(
    { my_kudos: post.my_kudos, kudos_count: post.kudos_count },
    (cur) => toggleKudosState(cur),
  );

  function send(giving: boolean) {
    setError(null);
    setPop(giving);
    startTransition(async () => {
      flip();
      const r = await toggleKudos(post.id);
      if (!r.ok) {
        setError(r.message ?? s.kudosError);
        return; // no refresh: the optimistic state drops back to the row as it was
      }
      // The card thought "not given" but the server had it (another tab), so
      // this toggle took it away. A give must never do that: put it back.
      if (giving && giveNeedsUndo(r)) await toggleKudos(post.id);
      router.refresh();
    });
  }

  return {
    given: state.my_kudos,
    count: state.kudos_count,
    pending,
    error,
    pop,
    clearPop: () => setPop(false),
    /** The flame: give or take back. */
    toggle: () => {
      if (pending || post.mine) return;
      send(!state.my_kudos);
    },
    /** The double tap: only ever gives. */
    give: () => {
      if (!doubleTapGives({ mine: post.mine, given: state.my_kudos, pending })) return;
      send(true);
    },
  };
}

type KudosApi = ReturnType<typeof useKudos>;

/**
 * Double tap on the media gives Kudos, with a flame that swells and fades
 * over it. Timed by hand from pointer events rather than `dblclick`, which
 * phones do not fire reliably; `touch-action: manipulation` stops the browser
 * reading the same gesture as zoom. The flame button is the same action for
 * anyone who cannot or does not double tap.
 */
function DoubleTapMedia({ onDoubleTap, children }: { onDoubleTap: () => void; children: React.ReactNode }) {
  const last = useRef<{ t: number; x: number; y: number } | null>(null);
  // Bumped per double tap so the burst restarts even mid-animation.
  const [burst, setBurst] = useState(0);
  return (
    <div
      className="relative select-none [touch-action:manipulation]"
      onPointerUp={(e) => {
        if (e.button !== 0) return;
        const next = { t: e.timeStamp, x: e.clientX, y: e.clientY };
        if (isDoubleTap(last.current, next)) {
          last.current = null;
          setBurst((b) => b + 1);
          onDoubleTap();
        } else {
          last.current = next;
        }
      }}
    >
      {children}
      {burst > 0 ? (
        <span
          key={burst}
          aria-hidden
          onAnimationEnd={() => setBurst(0)}
          className="kudos-burst pointer-events-none absolute inset-0 grid place-items-center"
        >
          {/* Gold fill, dark rim: legible on a photo, the cream tile and the gold one alike. */}
          <NavIcon d={FLAME} className="h-24 w-24 text-accent-fg [&>path]:fill-accent" />
        </span>
      ) : null}
    </div>
  );
}

// ---------- the card ----------

/**
 * One post, in the order the big feeds taught everyone to read:
 *
 *   header   avatar · name · what it is · who can see it          •••
 *   media    photo or snapshot; double tap gives Kudos
 *   actions  flame · comment                     (share · save: later)
 *   count    "12 Kudos"
 *   caption  name, then the text; #tags set apart, @mentions linked
 *   comments "View all 4 comments"
 *   time     "2h ago"
 *
 * A post with no media — plain text, a progress update — puts its words where
 * the media would be, larger, since there they are the post.
 *
 * What is deliberately not here, because nothing behind it exists yet: a coach
 * badge (social_feed does not return the author's role), Share and Save
 * buttons, a comment preview (the feed carries only the count), and Report or
 * Mute in someone else's menu. Deleted posts never reach the card —
 * social_feed and social_post both filter them.
 *
 * `bleed` is for the feed column: on a phone the card loses its edges and
 * runs to the screen's, and gets them back from `sm`.
 */
export function PostCard({ post, detail = false, bleed = false, removeOnUnsave = false }: {
  post: FeedPost;
  detail?: boolean;
  bleed?: boolean;
  /** On /saved: unsaving takes the card away at once, and brings it back if the request fails. */
  removeOnUnsave?: boolean;
}) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const kudos = useKudos(post);
  const save = useSave(post);
  const s = t.common.social;
  const p = post.payload;
  const media = hasMedia(post);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.text ?? "");
  const [editError, setEditError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [removed, setRemoved] = useState(false);

  if (removed) return null;
  if (removeOnUnsave && !save.saved) return null;

  const profile = `/people/${post.user_id}`;
  const nameLink = (
    <Link href={profile} className={`${SOCIAL.text.name} break-words hover:text-accent-ink`}>
      {post.author_name}
    </Link>
  );
  // Plain text posts need no kind; everything else says what it is.
  const kind = post.type === "text" ? null : s.postKind[post.type];
  // Folding is decided from the text, so server and browser agree and the
  // card never renders open and then snaps shut. The post's page shows all.
  const folded = !detail && !expanded && !editing && captionFolds(post.text);

  // Only the caption is editable: the media is the snapshot, and the database
  // refuses any other column (column-level update grant).
  const editForm = (
    <form
      className="px-4 pt-2"
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
          disabled={pending || (post.type === "text" && draft.trim().length === 0)}
          className="h-10 rounded-xl bg-accent px-4 font-display text-[13px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {s.saveEdit}
        </button>
      </div>
    </form>
  );

  const words = (className: string, lead?: React.ReactNode) =>
    post.text ? (
      <>
        {/* Handles are links only where a social_post_mentions row says so;
            everything else is a text node, never markup. */}
        <MentionText
          text={post.text}
          mentions={post.mentions ?? []}
          lead={lead}
          hashtags
          className={`whitespace-pre-wrap break-words px-4 ${className} ${folded ? "line-clamp-2" : ""}`}
        />
        {captionFolds(post.text) && !detail && !editing ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={!folded}
            className={`mx-4 mt-0.5 rounded ${SOCIAL.text.secondary} text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-accent`}
          >
            {folded ? s.showMore : s.showLess}
          </button>
        ) : null}
      </>
    ) : null;

  return (
    <article
      className={`bg-surface pb-3.5 ${
        bleed ? "sm:rounded-2xl sm:border sm:border-line" : "rounded-2xl border border-line"
      }`}
    >
      <header className="flex items-center gap-3 py-2.5 pl-4 pr-1.5">
        {/* The name link below is the one keyboard stop for the profile; the
            avatar is the same link for a thumb or a mouse. */}
        <Link href={profile} className="shrink-0 rounded-full" tabIndex={-1} aria-hidden>
          <Avatar name={post.author_name} url={post.author_avatar} size={SOCIAL.avatar.post} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate">{nameLink}</p>
          <p className={`mt-0.5 flex min-w-0 items-center gap-1 ${SOCIAL.text.meta}`}>
            {kind ? (
              <>
                <span className="truncate">{kind}</span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            <NavIcon d={VIS_ICON[post.visibility]} className="h-3 w-3" />
            <span className="shrink-0">{s.visibility[post.visibility]}</span>
            {post.edited_at ? (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0">{s.edited}</span>
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
            onDelete={() =>
              startTransition(async () => {
                setEditError(null);
                const r = await deletePost(post.id);
                if (!r.ok) {
                  setEditError(r.message ?? s.notFound);
                  return;
                }
                if (detail) router.push("/feed");
                else setRemoved(true);
                router.refresh();
              })
            }
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
          />
        ) : (
          // Keeps the header one height whether or not the menu is there.
          <span className="h-11 w-1 shrink-0" aria-hidden />
        )}
      </header>

      {media ? (
        // A share shows its original (links inside, so no double tap); a
        // shared routine is a link too: a double tap would be two taps on it.
        post.type === "shared_post" ? (
          <SharedEmbed post={post} />
        ) : post.mine || p?.kind === "program" ? (
          <PostMedia post={post} />
        ) : (
          <DoubleTapMedia onDoubleTap={kudos.give}>
            <PostMedia post={post} />
          </DoubleTapMedia>
        )
      ) : (
        // No media: the words take its place.
        <div className="pb-1">
          {p?.kind === "progress" ? (
            <div className="px-4 pb-1.5">
              <BlockLabel icon={TREND}>{s.progressUpdate}</BlockLabel>
            </div>
          ) : null}
          {editing ? editForm : words(SOCIAL.text.body)}
          {p?.kind === "progress" && typeof p.weight_kg === "number" ? (
            <p className="mt-1.5 px-4 text-[12.5px] tabular-nums text-ink-faint">{f.n(p.weight_kg)} kg</p>
          ) : null}
        </div>
      )}

      <ActionBar
        post={post}
        kudos={kudos}
        save={save}
        comment={
          // Same place either way: the post's own page, where the thread is.
          detail ? (
            <a href="#comments" aria-label={s.commentAction} title={s.commentAction} className={`${SOCIAL.iconButton} text-ink hover:text-ink-soft`}>
              <NavIcon d={COMMENT} className={SOCIAL.icon} />
            </a>
          ) : (
            <Link href={`/feed/${post.id}`} aria-label={s.commentAction} title={s.commentAction} className={`${SOCIAL.iconButton} text-ink hover:text-ink-soft`}>
              <NavIcon d={COMMENT} className={SOCIAL.icon} />
            </Link>
          )
        }
      />

      {media ? (editing ? editForm : <div className="mt-1">{words(SOCIAL.text.caption, <>{nameLink} </>)}</div>) : null}
      {editError ? <p role="status" className="mt-1.5 px-4 text-xs text-risk">{editError}</p> : null}

      {/* The post's own page shows the whole thread instead. */}
      {!detail ? <CommentPreview postId={post.id} total={post.comment_count} items={post.comment_preview} /> : null}

      <p className="mt-2 px-4">
        {/* Computed once from the clock; the server's render and the
            browser's can straddle a minute, which is not worth a mismatch. */}
        <time dateTime={post.created_at} title={f.at(post.created_at)} suppressHydrationWarning className={SOCIAL.text.time}>
          {f.when(post.created_at)}
        </time>
      </p>
    </article>
  );
}

/**
 * The "…" menu on your own post: edit the caption, or delete. Delete asks
 * twice — the second tap is the confirmation — because it cannot be undone
 * from here. Closes on an outside click or Escape; not a modal, so it traps
 * nothing. Nobody else's post has a menu: there is no Report, Mute or Block
 * behind one yet, and a menu of things that do nothing is worse than none.
 */
function PostMenu({ pending, onEdit, onDelete }: { pending: boolean; onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const s = t.common.social;
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
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

  const item = "flex min-h-11 w-full items-center rounded-xl px-3 text-left text-[13px] font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-label={s.postOptions}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${SOCIAL.iconButton} text-ink-faint hover:bg-bg hover:text-ink`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open ? (
        <div role="menu" className="absolute right-1 top-[calc(100%+4px)] z-20 w-52 rounded-2xl border border-line bg-surface p-1 shadow-lg">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onEdit(); }} className={`${item} text-ink hover:bg-bg`}>
            {s.editPost}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={() => {
              if (!confirming) { setConfirming(true); return; }
              setOpen(false);
              onDelete();
            }}
            className={`${item} text-risk hover:bg-risk-soft ${confirming ? "bg-risk-soft" : ""}`}
          >
            {confirming ? s.deleteConfirm : s.deletePost}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------- the action bar ----------

/**
 * Kudos · Comment · Share on the left, Save on the right, and the count under
 * them. Icons only in the row, every button the same 44px square whatever its
 * state, and the count on its own line — always present ("No Kudos yet" when
 * there are none) — so nothing in the row or below it moves when a state
 * changes. No share or save counts: neither is a public number.
 */
function ActionBar({ post, kudos, save, comment }: { post: FeedPost; kudos: KudosApi; save: SaveApi; comment: React.ReactNode }) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const [listOpen, setListOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const s = t.common.social;

  const flame = (on: boolean) => (
    <span className={kudos.pop ? "kudos-pop" : undefined} onAnimationEnd={kudos.clearPop}>
      <NavIcon d={FLAME} className={`${SOCIAL.icon} ${on ? "[&>path]:fill-current" : ""}`} />
    </span>
  );

  return (
    <div className="px-1.5 pt-1">
      <div className="flex items-center">
        {post.mine ? (
          // Own post: the flame cannot be given, so it opens the list instead.
          <button
            type="button"
            onClick={() => setListOpen(true)}
            disabled={kudos.count === 0}
            aria-label={fill(s.kudosCount, { count: kudos.count })}
            title={s.seeKudos}
            className={`${SOCIAL.iconButton} text-ink enabled:hover:text-ink-soft disabled:text-ink-faint`}
          >
            {flame(false)}
          </button>
        ) : (
          <button
            type="button"
            onClick={kudos.toggle}
            aria-pressed={kudos.given}
            aria-busy={kudos.pending}
            aria-label={kudos.given ? s.removeKudos : s.kudos}
            title={kudos.given ? s.removeKudos : s.kudos}
            className={`${SOCIAL.iconButton} transition-colors ${kudos.given ? "text-accent" : "text-ink hover:text-ink-soft"}`}
          >
            {flame(kudos.given)}
          </button>
        )}
        {comment}
        <button
          type="button"
          onClick={() => setSharing(true)}
          aria-label={s.share}
          aria-haspopup="dialog"
          title={s.share}
          className={`${SOCIAL.iconButton} text-ink hover:text-ink-soft`}
        >
          <NavIcon d={SEND} className={`${SOCIAL.icon} -translate-y-px`} />
        </button>
        <button
          type="button"
          onClick={save.toggle}
          aria-pressed={save.saved}
          aria-busy={save.pending}
          aria-label={save.saved ? s.unsave : s.save}
          title={save.saved ? s.unsave : s.save}
          className={`${SOCIAL.iconButton} ml-auto text-ink hover:text-ink-soft`}
        >
          <NavIcon d={BOOKMARK} className={`${SOCIAL.icon} ${save.saved ? "[&>path]:fill-current" : ""}`} />
        </button>
      </div>
      <div className="px-2.5">
        {kudos.count > 0 ? (
          <button
            type="button"
            onClick={() => setListOpen(true)}
            title={s.seeKudos}
            className={`${SOCIAL.text.count} rounded hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-accent`}
          >
            {fill(s.kudosCount, { count: f.n(kudos.count) })}
          </button>
        ) : (
          <p className={`${SOCIAL.text.count} font-normal text-ink-faint`}>{s.noKudosYet}</p>
        )}
      </div>
      {kudos.error ? <p role="status" className="mt-1 px-2.5 text-[11px] text-risk">{kudos.error}</p> : null}
      {save.error ? <p role="status" className="mt-1 px-2.5 text-[11px] text-risk">{s.saveError}</p> : null}
      {listOpen ? <KudosDialog postId={post.id} onClose={() => setListOpen(false)} /> : null}
      {sharing ? <ShareSheet post={post} onClose={() => setSharing(false)} /> : null}
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
    ...o, activity_id: null, challenge_id: null, kudos_count: 0, comment_count: 0, my_kudos: false,
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
      {hasMedia(inner) ? <PostMedia post={inner} /> : null}
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

/** Who gave kudos — a native <dialog>, first page on open, "Load more" for the rest. */
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
      aria-label={s.kudos}
      className="app-dialog m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl bg-surface p-0 text-ink"
    >
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
            <NavIcon d={FLAME} className="h-[19px] w-[19px] text-accent" />
            {s.kudos}
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
          <p className="py-6 text-center text-sm text-ink-faint">{s.noKudosYet}</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-line/60 overflow-y-auto">
            {items.map((k) => (
              <li key={k.user_id}>
                <Link href={`/people/${k.user_id}`} className="flex min-h-12 items-center gap-3 rounded-xl px-1 hover:bg-bg">
                  <Avatar name={k.name} url={k.avatar_url} size="h-9 w-9" />
                  <span className="min-w-0 truncate text-sm font-semibold">{k.name}</span>
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
export function Composer({ me }: { me?: { name: string; avatar_url: string | null } }) {
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
  const [error, setError] = useState<string | null>(null);
  const mention = useMentionSuggest(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const s = t.common.social;

  if (!open) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-2.5 pl-3">
        <div className="flex items-center gap-3">
          {me ? <Avatar name={me.name} url={me.avatar_url} size={SOCIAL.avatar.composer} /> : null}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-11 min-w-0 flex-1 truncate rounded-full bg-bg px-4 text-left text-[14.5px] text-ink-faint transition-colors hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {s.composerPlaceholder}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const r = progress
              // The box is in the reader's unit; social_posts stores kilograms
              // like every other weight, so the feed cannot mix the two.
              ? await createProgressPost(
                  text,
                  visibility,
                  includeWeight ? displayToKg(Number(weight.replace(",", ".")), u.weightUnit) : null,
                )
              : await createTextPost(text, visibility);
            if (!r.ok) setError(r.message ?? "Error");
            else { setText(""); setWeight(""); setIncludeWeight(false); setProgress(false); setOpen(false); mention.clear(); }
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
            placeholder={s.composerPlaceholder}
            maxLength={POST_TEXT_MAX}
            rows={3}
            className="min-w-0 flex-1 resize-none rounded-2xl border border-line bg-bg px-3.5 py-3 text-[15px] outline-none focus:border-accent"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <VisibilityPicker value={visibility} onChange={setVisibility} />
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
              onClick={() => setOpen(false)}
              className="h-11 rounded-2xl px-4 font-semibold text-ink-faint hover:bg-bg hover:text-ink"
            >
              {s.cancel}
            </button>
            <button
              type="submit"
              disabled={pending || text.trim().length === 0}
              className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              {s.post}
            </button>
          </div>
        </div>
        {error ? <p className="mt-2 text-xs text-risk">{error}</p> : null}
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

export type PostPhoto = { publicId: string; version: number; previewUrl: string };

export function SharePanel({ session, onShare, onSharePr, photoUploads = false }: {
  session: ShareableSession;
  onShare: (visibility: PostVisibility, text: string, photo: { publicId: string; version: number } | null) => Promise<{ ok: boolean; message?: string }>;
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
  const [sharedPrs, setSharedPrs] = useState<Set<string>>(new Set(session.prs.filter((p) => p.shared).map((p) => p.set_id)));
  const [error, setError] = useState<string | null>(null);
  const s = t.common.social;

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
            {photoUploads ? <PhotoPicker photo={photo} onChange={setPhoto} disabled={pending} /> : null}
            <VisibilityPicker value={visibility} onChange={setVisibility} />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const r = await onShare(visibility, text, photo ? { publicId: photo.publicId, version: photo.version } : null);
                  if (!r.ok) setError(r.message ?? "Error");
                  else setShared(true);
                  router.refresh();
                })
              }
              className="flex h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50 sm:w-auto"
            >
              {s.shareToFeed}
            </button>
          </div>
        ) : (
          <p className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-accent-ink">
            <NavIcon d={CHECK} className="h-4 w-4 [stroke-width:2.4]" />
            {s.shared}
          </p>
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


/** How big a post photo may be before the browser refuses to send it. */
const POST_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

/**
 * "Add a photo" for a workout post — the gym selfie.
 *
 * `capture="environment"` is deliberately *not* set: on a phone the picker
 * offers both the camera and the library, and someone who wants a selfie wants
 * the front camera, which only the unhinted picker lets them choose. The file
 * goes straight to Cloudinary under a signature this server minted
 * (requestPostPhotoUpload), so it never passes through a server action body,
 * and the post only carries the public_id and version — the URL itself is
 * rebuilt server-side when the post is written.
 */
function PhotoPicker({ photo, onChange, disabled }: {
  photo: PostPhoto | null;
  onChange: (photo: PostPhoto | null) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const s = t.common.social;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) { setError(s.photoNotImage); return; }
    if (file.size > POST_PHOTO_MAX_BYTES) { setError(s.photoTooLarge); return; }
    setBusy(true);
    try {
      const permission = await requestPostPhotoUpload();
      if (!permission.ok || !permission.ticket) { setError(permission.message ?? s.photoFailed); return; }
      const ticket = permission.ticket;
      const body = new FormData();
      body.append("file", file);
      body.append("api_key", ticket.apiKey);
      for (const [key, value] of Object.entries(ticket.fields)) body.append(key, value);
      const response = await fetch(`https://api.cloudinary.com/v1_1/${ticket.cloudName}/image/upload`, { method: "POST", body });
      if (!response.ok) { setError(s.photoFailed); return; }
      const uploaded = (await response.json()) as { public_id?: string; version?: number; secure_url?: string };
      if (!uploaded.public_id || !uploaded.version) { setError(s.photoFailed); return; }
      onChange({ publicId: uploaded.public_id, version: uploaded.version, previewUrl: uploaded.secure_url ?? "" });
    } catch {
      setError(s.photoFailed);
    } finally {
      setBusy(false);
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
            disabled={disabled || busy}
            onClick={() => onChange(null)}
            className="inline-flex h-10 items-center rounded-2xl px-3.5 text-[13px] font-semibold text-ink-faint hover:bg-bg hover:text-risk disabled:opacity-50"
          >
            {s.photoRemove}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-bg px-4 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
        >
          <NavIcon d="M4 8h3l1.5-2h7L17 8h3v11H4zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7" className="h-[18px] w-[18px]" />
          {busy ? t.common.actions.loading : s.photoAdd}
        </button>
      )}
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">{s.photoHint}</p>
      {error ? <p className="mt-1 text-[12.5px] text-risk">{error}</p> : null}
    </div>
  );
}
