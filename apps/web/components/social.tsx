"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import type { PostVisibility } from "@healthapp/shared";
import { kudosSummary, toggleKudosState, POST_TEXT_MAX, COMMENT_MAX } from "@healthapp/shared";
import {
  addComment, createProgressPost, createTextPost, deleteComment, deletePost, follow, loadKudos, toggleKudos, unfollow,
} from "@/app/social-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { parseDay } from "@/lib/week";
import type { FeedPost, KudosGiver, PostComment, ShareableSession } from "@/lib/types";
import { Card } from "./ui";

// ---------- small pieces ----------

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
    duration: (min: number | null) => (min === null ? null : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min} min`),
  };
}

export function VisibilityPicker({ value, onChange }: { value: PostVisibility; onChange: (v: PostVisibility) => void }) {
  const { t } = useI18n();
  const s = t.common.social;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-ink-faint">{s.visibilityLabel}</span>
      <div className="inline-flex overflow-hidden rounded-lg border border-line font-semibold">
        {(["public", "followers", "private"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`px-2.5 py-1.5 ${value === v ? "bg-accent text-accent-fg" : "text-ink-soft hover:text-ink"}`}
          >
            {s.visibility[v]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- post content by type ----------

function PostBody({ post }: { post: FeedPost }) {
  const { t, locale } = useI18n();
  const f = useSocialFormat();
  const s = t.common.social;
  const p = post.payload;
  return (
    <>
      {p?.kind === "workout" ? (
        <div className="mt-2 rounded-lg bg-bg p-3">
          <p className="font-bold">🏋️ {p.name}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-soft">
            {f.duration(p.duration_min) ? <span>{f.duration(p.duration_min)}</span> : null}
            <span>{fill(s.exercisesCount, { count: p.exercises })}</span>
            <span>{fill(s.setsCount, { count: p.sets })}</span>
            <span>{fill(s.volume, { kg: f.n(p.volume_kg) })}</span>
          </p>
          <p className="mt-2 text-sm font-semibold text-accent-ink">🔥 {fill(s.trainingLoad, { load: p.load })}</p>
          {p.prs > 0 ? <p className="mt-0.5 text-xs text-ink-soft">🏆 {p.prs} {s.prs}</p> : null}
        </div>
      ) : null}
      {p?.kind === "pr" ? (
        <div className="mt-2 rounded-lg bg-accent-soft p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">🏆 {s.newPr}</p>
          <p className="mt-1 font-bold">{p.exercise}</p>
          <p className="text-sm tabular-nums text-ink-soft">
            {f.n(p.weight_kg)} kg × {p.reps} <span className="text-ink-faint">· {s.personalBest}</span>
          </p>
        </div>
      ) : null}
      {p?.kind === "challenge_completed" ? (
        <div className="mt-2 rounded-lg bg-accent-soft p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">🏆 {s.challengeCompleted}</p>
          <p className="mt-1 font-bold">{locale === "ro" ? p.title_ro : p.title_en}</p>
          <p className="text-sm tabular-nums text-ink-soft">
            {f.n(p.value)} / {f.n(p.target)} {t.common.challenges.unit[p.type as keyof typeof t.common.challenges.unit] ?? ""}
          </p>
        </div>
      ) : null}
      {p?.kind === "streak" ? (
        <div className="mt-2 rounded-lg bg-accent-soft p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">🔥 {t.common.streaks.title}</p>
          <p className="mt-1 font-bold">{fill(t.common.streaks.milestoneTitle, { count: p.milestone })}</p>
          <p className="text-sm text-ink-soft">{fill(t.common.streaks.postBody, { count: p.streak_days })}</p>
        </div>
      ) : null}
      {p?.kind === "progress" ? (
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-accent-ink">📈 {s.progressUpdate}</p>
      ) : null}
      {post.text ? <p className="mt-2 whitespace-pre-wrap break-words text-sm">{post.text}</p> : null}
      {p?.kind === "progress" && typeof p.weight_kg === "number" ? (
        <p className="mt-1 text-xs tabular-nums text-ink-soft">{f.n(p.weight_kg)} kg</p>
      ) : null}
    </>
  );
}

// ---------- the card ----------

export function PostCard({ post, detail = false }: { post: FeedPost; detail?: boolean }) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const s = t.common.social;

  return (
    <Card>
      <div className="flex items-start gap-3">
        <Link href={`/people/${post.user_id}`} className="shrink-0">
          <Avatar name={post.author_name} url={post.author_avatar} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <Link href={`/people/${post.user_id}`} className="truncate font-semibold hover:text-accent-ink">
              {post.author_name}
            </Link>
            <span className="shrink-0 text-xs text-ink-faint">{f.when(post.created_at)}</span>
          </div>
          <p className="text-[11px] text-ink-faint">{s.visibility[post.visibility]}</p>
        </div>
      </div>

      <PostBody post={post} />

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-xs">
        <Kudos post={post} />
        <Link href={`/feed/${post.id}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 font-semibold text-ink-soft hover:bg-bg">
          💬 <span className="tabular-nums">{post.comment_count}</span> <span className="hidden sm:inline">{s.comments}</span>
        </Link>
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
            className="order-last ml-auto text-ink-faint hover:text-risk"
          >
            {s.deletePost}
          </button>
        ) : null}
      </div>
    </Card>
  );
}

// ---------- kudos ----------

/**
 * The give/take-back button, the count (opens who gave it) and the
 * "Norbert, Maria and 3 others" line. Rendered as a fragment so the pieces
 * sit in the card's action row. The flip is optimistic: useOptimistic shows
 * the new state at once and falls back to the server's row when the
 * transition ends, so a failed action rolls back by itself — the only extra
 * work is saying so, quietly, under the row.
 */
function Kudos({ post }: { post: FeedPost }) {
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

  return (
    <>
      <span className="inline-flex items-center">
        {post.mine ? (
          <span className="inline-flex min-h-9 items-center gap-1.5 px-2 font-semibold text-ink-soft" aria-hidden>🔥 {s.kudos}</span>
        ) : (
          <button
            type="button"
            onClick={toggle}
            aria-pressed={state.my_kudos}
            aria-busy={pending}
            title={state.my_kudos ? s.removeKudos : s.kudos}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 font-semibold transition-colors ${
              state.my_kudos ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-bg"
            } ${pending ? "opacity-70" : ""}`}
          >
            🔥 <span>{s.kudos}</span>
          </button>
        )}
        <button
          type="button"
          onClick={openList}
          disabled={state.kudos_count === 0}
          aria-label={fill(s.kudosCount, { count: state.kudos_count })}
          title={s.seeKudos}
          className={`min-h-9 rounded-lg px-1.5 font-semibold tabular-nums ${state.kudos_count > 0 ? "text-ink hover:bg-bg" : "text-ink-faint"}`}
        >
          {state.kudos_count}
        </button>
      </span>
      {line ? (
        <button type="button" onClick={openList} className="order-last ml-auto min-w-0 truncate text-left text-ink-faint hover:text-ink">
          {line}
        </button>
      ) : null}
      {error ? <p role="status" className="order-last basis-full text-[11px] text-risk">{error}</p> : null}
      {listOpen ? <KudosDialog postId={post.id} onClose={() => setListOpen(false)} /> : null}
    </>
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
      className="app-dialog m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-line bg-bg p-0 text-ink shadow-2xl"
    >
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-bold">🔥 {s.kudos}</p>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label={t.common.actions.close}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-surface hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {items === null ? (
          <p className="py-6 text-center text-sm text-ink-faint">{t.common.actions.loading}</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint">{s.noKudosYet}</p>
        ) : (
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {items.map((k) => (
              <li key={k.user_id}>
                <Link href={`/people/${k.user_id}`} className="flex min-h-11 items-center gap-3 rounded-lg px-1 hover:bg-surface">
                  <Avatar name={k.name} url={k.avatar_url} size="h-8 w-8" />
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
            className="mt-3 min-h-11 w-full rounded-lg border border-line text-sm font-semibold text-ink-soft hover:border-accent disabled:opacity-50"
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
    <Card>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        💬 {comments.length === 1 ? s.commentOne : fill(s.commentsCount, { count: comments.length })}
      </p>
      <ul className="mt-3 space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="flex items-start gap-2.5">
            <Avatar name={c.author_name} url={c.author_avatar} size="h-7 w-7" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-semibold">{c.author_name}</span>
                <span className="shrink-0 text-ink-faint">{f.when(c.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
              {c.mine ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(async () => { await deleteComment(c.id, postId); router.refresh(); })}
                  className="mt-0.5 text-[11px] text-ink-faint hover:text-risk"
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
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm"
        />
        <button type="submit" disabled={pending || body.trim().length === 0} className="min-h-11 shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-40">
          {s.send}
        </button>
      </form>
      {error ? <p className="mt-2 text-xs text-risk">{error}</p> : null}
    </Card>
  );
}

// ---------- composer ----------

export function Composer() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [progress, setProgress] = useState(false);
  const [includeWeight, setIncludeWeight] = useState(false);
  const [weight, setWeight] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("followers");
  const [error, setError] = useState<string | null>(null);
  const s = t.common.social;
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const r = progress
              ? await createProgressPost(text, visibility, includeWeight ? Number(weight.replace(",", ".")) : null)
              : await createTextPost(text, visibility);
            if (!r.ok) setError(r.message ?? "Error");
            else { setText(""); setWeight(""); setIncludeWeight(false); }
            router.refresh();
          });
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, POST_TEXT_MAX))}
          placeholder={s.composerPlaceholder}
          maxLength={POST_TEXT_MAX}
          rows={2}
          className="w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <VisibilityPicker value={visibility} onChange={setVisibility} />
          <span className="text-[11px] tabular-nums text-ink-faint">{text.length}/{POST_TEXT_MAX}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <label className="inline-flex min-h-9 items-center gap-1.5 text-ink-soft">
            <input type="checkbox" checked={progress} onChange={(e) => setProgress(e.target.checked)} className="accent-[var(--color-accent)]" />
            📈 {s.progressUpdate}
          </label>
          {progress ? (
            <label className="inline-flex min-h-9 items-center gap-1.5 text-ink-soft">
              <input type="checkbox" checked={includeWeight} onChange={(e) => setIncludeWeight(e.target.checked)} className="accent-[var(--color-accent)]" />
              {s.progressWeightOptIn}
              {includeWeight ? (
                <input
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  inputMode="decimal"
                  placeholder="kg"
                  className="w-20 rounded-lg border border-line bg-bg px-2 py-1 text-sm"
                />
              ) : null}
            </label>
          ) : null}
          <button type="submit" disabled={pending || text.trim().length === 0} className="ml-auto min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-40">
            {s.post}
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-risk">{error}</p> : null}
      </form>
    </Card>
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
      className={`min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold disabled:opacity-50 ${
        state ? "border border-line text-ink-soft hover:border-risk hover:text-risk" : "bg-accent text-accent-fg hover:opacity-90"
      } ${compact ? "" : "min-h-11 px-4 text-sm"}`}
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
      <Card>
        <p className="text-lg font-bold">🏋️ {session.name}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-ink-soft">
          {f.duration(session.duration_min) ? <span>{f.duration(session.duration_min)}</span> : null}
          <span>{fill(s.exercisesCount, { count: session.exercises })}</span>
          <span>{fill(s.setsCount, { count: session.sets })}</span>
          <span>{fill(s.volume, { kg: f.n(session.volume_kg) })}</span>
        </p>
        <p className="mt-2 font-semibold text-accent-ink">🔥 {fill(s.trainingLoad, { load: session.load })}</p>
        {!shared ? (
          <div className="mt-4 space-y-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, POST_TEXT_MAX))}
              placeholder={s.composerPlaceholder}
              className="min-h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm"
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
              className="min-h-11 w-full rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-50 sm:w-auto"
            >
              {s.shareToFeed}
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm font-semibold text-accent-ink">✓ {s.shared}</p>
        )}
        {error ? <p className="mt-2 text-xs text-risk">{error}</p> : null}
      </Card>

      {session.prs.length > 0 ? (
        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">🏆 {s.newPr}</p>
          <ul className="mt-2 space-y-2">
            {session.prs.map((pr) => (
              <li key={pr.set_id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{pr.exercise}</p>
                  <p className="text-xs tabular-nums text-ink-soft">{f.n(pr.weight_kg)} kg × {pr.reps}</p>
                </div>
                {sharedPrs.has(pr.set_id) ? (
                  <span className="shrink-0 text-xs font-semibold text-accent-ink">✓ {s.prShared}</span>
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
                    className="min-h-9 shrink-0 rounded-lg border border-line px-3 text-xs font-semibold hover:border-accent disabled:opacity-50"
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
