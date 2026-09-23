"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import type { PostVisibility } from "@healthapp/shared";
import { displayToKg, kudosSummary, toggleKudosState, POST_TEXT_MAX } from "@healthapp/shared";
import {
  createProgressPost, createTextPost, deletePost, editPost, follow, loadKudos, requestPostPhotoUpload, toggleKudos, unfollow,
} from "@/app/social-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { parseDay } from "@/lib/week";
import { durationLabel } from "@/lib/share-card";
import type { FeedPost, KudosGiver, ShareableSession } from "@/lib/types";
import { NavIcon } from "./client-nav";
import { Card } from "./ui";
import { BadgeGlyph, MentionSuggestions, MentionText, useMentionSuggest } from "./social-v2";

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
    when: (iso: string) => {
      const ms = Date.now() - new Date(iso).getTime();
      const h = Math.floor(ms / 3_600_000);
      if (h < 1) return s.justNow;
      if (h < 24) return fill(s.hoursAgo, { h });
      return dtf.format(new Date(iso));
    },
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
      <p className="truncate font-display text-[28px] font-extrabold leading-none tracking-tight tabular-nums sm:text-[30px]">
        {value}
        {unit ? <span className="ml-1 font-sans text-[13px] font-semibold text-tile-soft">{unit}</span> : null}
      </p>
      <p className="mt-1.5 text-[11.5px] text-tile-soft">{label}</p>
    </div>
  );
}

/**
 * The post's "media", where a photo would sit on Instagram: a workout is an
 * inverse tile with its figures large, a record or a milestone a solid gold
 * tile with the number as the hero. Text and progress posts have no tile.
 */
function PostMedia({ post }: { post: FeedPost }) {
  const { t, locale } = useI18n();
  const f = useSocialFormat();
  const s = t.common.social;
  const p = post.payload;
  if (!p || p.kind === "progress") return null;

  if (p.kind === "workout") {
    const dur = f.duration(p.duration_min);
    const photo = typeof p.photo_url === "string" && p.photo_url.startsWith("https://") ? p.photo_url : null;
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
    // bleed, the workout's name and its headline number sitting on it behind a
    // gradient, and the rest of the figures underneath on the tile. Without
    // one it is the tile alone, exactly as before.
    return (
      <div className="mx-3 overflow-hidden rounded-2xl bg-tile text-tile-ink">
        {photo ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="block max-h-[28rem] w-full bg-bg object-cover"
            />
            {/* The scrim exists so white text is legible on any photo; it is
                opaque at the bottom and clear at the top, so the picture is
                never dimmed where nothing sits on it. */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-5 pb-4 pt-14 text-white">
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
          </div>
        ) : null}
        <div className={photo ? "px-5 pb-5 pt-4" : "px-5 pb-5 pt-4"}>
          {photo ? null : (
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
 * One post, laid out like the feeds people already know: header (who, when,
 * who can see it), media, caption, then the action row and the "Kudos from"
 * line under it. The detail page adds the delete control for own posts.
 */
export function PostCard({ post, detail = false }: { post: FeedPost; detail?: boolean }) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const s = t.common.social;
  const p = post.payload;
  const caption = p !== null; // text under a tile or an eyebrow reads as a caption; alone it is the post
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.text ?? "");
  const [editError, setEditError] = useState<string | null>(null);

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
            // Delete stays where it has always been: on the post's own page.
            onDelete={detail ? () =>
              startTransition(async () => {
                await deletePost(post.id);
                router.push("/feed");
                router.refresh();
              }) : undefined}
          />
        ) : null}
      </div>

      <PostMedia post={post} />

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
              disabled={pending || (post.type === "text" && draft.trim().length === 0)}
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

      <Kudos
        post={post}
        comments={
          detail ? (
            <span className="inline-flex h-10 items-center gap-2 px-2.5 font-semibold text-ink-soft">
              <NavIcon d={COMMENT} className="h-[22px] w-[22px]" />
              <span className="text-[14px] tabular-nums">{post.comment_count}</span>
            </span>
          ) : (
            <Link
              href={`/feed/${post.id}`}
              title={s.comments}
              className="inline-flex h-10 items-center gap-2 rounded-full px-2.5 font-semibold text-ink-soft hover:bg-bg hover:text-ink"
            >
              <NavIcon d={COMMENT} className="h-[22px] w-[22px]" />
              <span className="text-[14px] tabular-nums">{post.comment_count}</span>
            </Link>
          )
        }
      />
    </article>
  );
}

/**
 * The "…" menu on your own post: edit the caption, or delete. Closes on an
 * outside click or Escape; not a modal, so it traps nothing.
 */
function PostMenu({ pending, onEdit, onDelete }: { pending: boolean; onEdit: () => void; onDelete?: () => void }) {
  const { t } = useI18n();
  const s = t.common.social;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

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

// ---------- kudos ----------

/**
 * The action row (flame + count, then the comments control the card passes
 * in) and the "Kudos from Norbert, Maria and 3 others" line under it, which
 * opens the list of givers. The flip is optimistic: useOptimistic shows the
 * new state at once and falls back to the server's row when the transition
 * ends, so a failed action rolls back by itself — the only extra work is
 * saying so, quietly, under the row.
 */
function Kudos({ post, comments }: { post: FeedPost; comments: React.ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const s = t.common.social;
  const [state, flip] = useOptimistic<{ my_kudos: boolean; kudos_count: number }, void>(
    { my_kudos: post.my_kudos, kudos_count: post.kudos_count },
    (cur) => toggleKudosState(cur),
  );

  // The names travel with the row; when the viewer's own flip is in flight the
  // count moves but the names do not — kudosSummary keeps them consistent.
  const summary = kudosSummary(state.kudos_count, post.kudos_names);
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

  function toggle() {
    if (pending) return; // one request at a time per button; a second tap waits for the row
    setError(null);
    startTransition(async () => {
      flip();
      const r = await toggleKudos(post.id);
      if (!r.ok) {
        setError(r.message ?? s.kudosError);
        return; // no refresh: the optimistic state drops back to the row as it was
      }
      router.refresh();
    });
  }

  const openList = () => { if (state.kudos_count > 0) setListOpen(true); };
  const count = <span className="text-[14px] tabular-nums">{state.kudos_count}</span>;

  return (
    <div className="mt-3 px-3">
      <div className="flex items-center gap-1">
        {post.mine ? (
          // Own post: the flame cannot be given, so the pill opens the list instead.
          <button
            type="button"
            onClick={openList}
            disabled={state.kudos_count === 0}
            aria-label={fill(s.kudosCount, { count: state.kudos_count })}
            title={s.seeKudos}
            className="inline-flex h-10 items-center gap-2 rounded-full px-2.5 font-semibold text-ink-soft enabled:hover:bg-bg enabled:hover:text-ink"
          >
            <NavIcon d={FLAME} className="h-[22px] w-[22px]" />
            {count}
          </button>
        ) : (
          <button
            type="button"
            onClick={toggle}
            aria-pressed={state.my_kudos}
            aria-busy={pending}
            aria-label={state.my_kudos ? s.removeKudos : s.kudos}
            title={state.my_kudos ? s.removeKudos : s.kudos}
            className={`inline-flex h-10 items-center gap-2 rounded-full px-2.5 font-semibold transition-colors ${
              state.my_kudos ? "text-accent-ink hover:bg-accent-soft" : "text-ink-soft hover:bg-bg hover:text-ink"
            } ${pending ? "opacity-70" : ""}`}
          >
            <NavIcon d={FLAME} className={`h-[22px] w-[22px] ${state.my_kudos ? "[&>path]:fill-current" : ""}`} />
            {count}
          </button>
        )}
        {comments}
      </div>
      {line ? (
        <button
          type="button"
          onClick={openList}
          className="mt-0.5 block max-w-full truncate px-2.5 text-left text-[13px] text-ink-soft hover:text-ink"
        >
          {fill(s.kudosFrom, { names: line })}
        </button>
      ) : null}
      {error ? <p role="status" className="mt-1 px-2.5 text-[11px] text-risk">{error}</p> : null}
      {listOpen ? <KudosDialog postId={post.id} onClose={() => setListOpen(false)} /> : null}
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
      <div className="rounded-3xl bg-surface p-3">
        <div className="flex items-center gap-3">
          {me ? <Avatar name={me.name} url={me.avatar_url} size="h-10 w-10" /> : null}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-11 min-w-0 flex-1 truncate rounded-full bg-bg px-4 text-left text-[14.5px] text-ink-faint hover:text-ink-soft"
          >
            {s.composerPlaceholder}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-surface p-4">
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

export function FollowButton({ userId, following, compact = false }: { userId: string; following: boolean; compact?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useOptimistic(following, (_, next: boolean) => next);
  const s = t.common.social;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          setState(!state);
          await (state ? unfollow(userId) : follow(userId));
          router.refresh();
        })
      }
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold disabled:opacity-50 ${
        state ? "bg-bg text-ink-soft hover:text-risk" : "bg-accent text-accent-fg hover:opacity-90"
      } ${compact ? "h-9 px-4 text-[12.5px]" : "h-11 px-5 font-display text-sm font-bold"}`}
    >
      {state ? s.following : s.follow}
    </button>
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
