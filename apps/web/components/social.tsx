"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import type { PostVisibility } from "@healthapp/shared";
import { displayToKg, kudosSummary, toggleKudosState, POST_TEXT_MAX, COMMENT_MAX } from "@healthapp/shared";
import {
  addComment, createProgressPost, createTextPost, deleteComment, deletePost, follow, loadKudos, toggleKudos, unfollow,
} from "@/app/social-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { parseDay } from "@/lib/week";
import { durationLabel } from "@/lib/share-card";
import type { FeedPost, KudosGiver, PostComment, ShareableSession } from "@/lib/types";
import { NavIcon } from "./client-nav";
import { Card } from "./ui";

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

function useSocialFormat() {
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
    return (
      <div className="mx-3 rounded-2xl bg-tile px-5 pb-5 pt-4 text-tile-ink">
        <BlockLabel icon={DUMBBELL} tone="text-tile-accent">{s.workoutPost}</BlockLabel>
        <p className="mt-1 truncate font-display text-[26px] font-extrabold leading-tight tracking-tight">{p.name}</p>
        <div className={`mt-4 grid gap-3 ${dur ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
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
          </p>
        </div>
        {post.mine && detail ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await deletePost(post.id);
                router.push("/feed");
                router.refresh();
              })
            }
            className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold text-ink-faint hover:bg-bg hover:text-risk"
          >
            {s.deletePost}
          </button>
        ) : null}
      </div>

      <PostMedia post={post} />

      {p?.kind === "progress" ? (
        <div className="px-5">
          <BlockLabel icon={TREND}>{s.progressUpdate}</BlockLabel>
        </div>
      ) : null}
      {post.text ? (
        <p className={`whitespace-pre-wrap break-words px-5 leading-relaxed ${caption ? "mt-3 text-[15px]" : "text-[17px]"}`}>{post.text}</p>
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

export function Comments({ postId, comments }: { postId: string; comments: PostComment[] }) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const s = t.common.social;
  return (
    <Card plain className="p-5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        <NavIcon d={COMMENT} className="h-[15px] w-[15px]" />
        {comments.length === 1 ? s.commentOne : fill(s.commentsCount, { count: comments.length })}
      </p>
      <ul className="mt-3.5 space-y-3.5">
        {comments.map((c) => (
          <li key={c.id} className="flex items-start gap-2.5">
            <Avatar name={c.author_name} url={c.author_avatar} size="h-8 w-8" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-semibold">{c.author_name}</span>
                <span className="shrink-0 text-[12px] text-ink-faint">{f.when(c.created_at)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed">{c.body}</p>
              {c.mine ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(async () => { await deleteComment(c.id, postId); router.refresh(); })}
                  className="mt-1 text-[11px] font-semibold text-ink-faint hover:text-risk"
                >
                  {s.deleteComment}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const r = await addComment(postId, body);
            if (!r.ok) setError(r.message ?? "Error");
            else setBody("");
            router.refresh();
          });
        }}
      >
        <input
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, COMMENT_MAX))}
          placeholder={s.writeComment}
          maxLength={COMMENT_MAX}
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending || body.trim().length === 0}
          className="flex h-11 shrink-0 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {s.send}
        </button>
      </form>
      {error ? <p className="mt-2 text-xs text-risk">{error}</p> : null}
    </Card>
  );
}

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
            else { setText(""); setWeight(""); setIncludeWeight(false); setProgress(false); setOpen(false); }
            router.refresh();
          });
        }}
      >
        <div className="flex items-start gap-3">
          {me ? <Avatar name={me.name} url={me.avatar_url} size="h-10 w-10" /> : null}
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, POST_TEXT_MAX))}
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

export function SharePanel({ session, onShare, onSharePr }: {
  session: ShareableSession;
  onShare: (visibility: PostVisibility, text: string) => Promise<{ ok: boolean; message?: string }>;
  onSharePr: (setId: string, visibility: PostVisibility) => Promise<{ ok: boolean; message?: string }>;
}) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [visibility, setVisibility] = useState<PostVisibility>("followers");
  const [text, setText] = useState("");
  const [shared, setShared] = useState(session.already_shared);
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
            <VisibilityPicker value={visibility} onChange={setVisibility} />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const r = await onShare(visibility, text);
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
