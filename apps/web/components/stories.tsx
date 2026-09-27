"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  STORY_BACKGROUNDS, STORY_TEXT_MAX, firstUnseenIndex, nextStoryPos, prevStoryPos, storyDurationMs,
  type StoryBackground, type StoryPos,
} from "@healthapp/shared";
import { deleteStory, loadStories, loadStoryViewers, markStorySeen, publishStory } from "@/app/story-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { SOCIAL } from "@/lib/social-ui";
import type { Story, StoryTrayItem, StoryViewerRow } from "@/lib/types";
import { NavIcon } from "./client-nav";
import { Avatar, useSocialFormat } from "./social";

const PLUS = "M12 7v10M7 12h10";
const CLOSE = "M6 6l12 12M18 6L6 18";
const EYE = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6";
const TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3";
const PAUSE = "M9 5v14M15 5v14";
const PLAY = "M7 5v14l12-7z";

/** Story backgrounds, from the theme-invariant story tokens (and the brand gold). */
const TONE: Record<StoryBackground, string> = {
  gold: "bg-accent text-accent-fg",
  night: "bg-story-night text-story-night-ink",
  paper: "bg-story-paper text-story-paper-ink",
};

type Me = { name: string; avatar_url: string | null };

// ---------- the row ----------

/**
 * The stories row across the top of the feed, fed by social_story_tray() —
 * already ordered by the database (you, then unseen, then seen) and already
 * limited to the people you may see. "Your story" always comes first: with a
 * live story it opens the viewer, and its plus badge adds another; without
 * one, the whole circle adds one.
 *
 * Rings: gold for something unseen, a quiet line colour once seen. A ring
 * turns quiet the moment its last story is opened here, before the page's
 * data catches up on close.
 */
export function StoriesBar({ me, tray }: { me?: Me; tray: StoryTrayItem[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const s = t.common.stories;
  const [open, setOpen] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [seenHere, setSeenHere] = useState<Set<string>>(() => new Set());

  const mine = tray.find((a) => a.is_me);
  const others = tray.filter((a) => !a.is_me);
  const unseen = (a: StoryTrayItem) => a.unseen > 0 && !seenHere.has(a.user_id);
  const openAt = (userId: string) => setOpen(tray.findIndex((a) => a.user_id === userId));

  const circle = (a: { name: string; avatar_url: string | null }, ring: "unseen" | "seen" | "none") => (
    <span
      className={`block transition-transform duration-200 group-hover:scale-[1.04] group-active:scale-95 motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${
        ring === "none" ? "p-[2.5px]" : ring === "seen" ? "story-ring story-ring--seen" : "story-ring"
      }`}
    >
      <Avatar name={a.name} url={a.avatar_url} size={SOCIAL.avatar.story} />
    </span>
  );
  const label = "w-full truncate text-center text-[11.5px]";
  const focus = "rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <section aria-label={s.title} className={SOCIAL.bleed}>
      <ul className="no-scrollbar flex items-start gap-3.5 overflow-x-auto px-4 py-1 sm:px-0.5">
        {me ? (
          <li className="relative w-[72px] shrink-0">
            <button
              type="button"
              onClick={() => (mine ? openAt(mine.user_id) : setComposing(true))}
              aria-label={mine ? t.common.social.yourStory : s.add}
              className={`group flex w-full flex-col items-center gap-1.5 ${focus}`}
            >
              {circle(me, mine ? "unseen" : "none")}
              <span className={`${label} text-ink-soft`}>{t.common.social.yourStory}</span>
            </button>
            {/* The plus is its own button when there is a story to open, so
                both "watch mine" and "add another" are one tap. */}
            {mine ? (
              <button
                type="button"
                onClick={() => setComposing(true)}
                aria-label={s.add}
                className="absolute left-[46px] top-[44px] grid h-7 w-7 place-items-center rounded-full"
              >
                <PlusBadge />
              </button>
            ) : (
              <span aria-hidden className="pointer-events-none absolute left-[49px] top-[47px]">
                <PlusBadge />
              </span>
            )}
          </li>
        ) : null}

        {others.map((a) => {
          const fresh = unseen(a);
          return (
            <li key={a.user_id} className="w-[72px] shrink-0">
              <button
                type="button"
                onClick={() => openAt(a.user_id)}
                aria-label={fill(fresh ? s.unseenOf : s.seenOf, { name: a.name })}
                className={`group flex w-full flex-col items-center gap-1.5 ${focus}`}
              >
                {circle(a, fresh ? "unseen" : "seen")}
                <span className={`${label} ${fresh ? "text-ink" : "text-ink-faint"}`}>{a.name}</span>
              </button>
            </li>
          );
        })}

        {others.length === 0 ? (
          <li className="flex min-w-[180px] max-w-[280px] flex-1 items-center self-stretch pb-5">
            <p className="text-[12.5px] leading-snug text-ink-faint">{s.noneFollowed}</p>
          </li>
        ) : null}
      </ul>

      {open !== null && open >= 0 ? (
        <StoryViewer
          authors={tray}
          start={open}
          onSeenAuthor={(id) => setSeenHere((prev) => new Set(prev).add(id))}
          onClose={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      ) : null}
      {composing && me ? (
        <StoryComposer
          me={me}
          onClose={(published) => {
            setComposing(false);
            if (published) router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function PlusBadge() {
  return (
    <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-accent text-accent-fg ring-[2.5px] ring-bg">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
        <path d={PLUS} />
      </svg>
    </span>
  );
}

// ---------- the viewer ----------

type Loaded = Story[] | "error";

/**
 * Full screen, dark, one story at a time: progress bars across the top (one
 * per story of this author), who and when, the words in the middle. Tap the
 * left third for the previous story, anywhere else for the next; hold to
 * pause. After an author's last story comes the next author's first unseen
 * one; after the last author, the viewer closes. Arrow keys do the same,
 * Space pauses, Escape and the phone's back button close.
 *
 * Each author's stories load when the viewer reaches them (one read per
 * author, never per story). Opening a story marks it seen — once, in the
 * database, and never for your own. The timer runs only while the story is
 * on screen and nothing covers it: a hidden tab, a held finger, the viewers
 * list or the delete confirmation all stop it, and every story starts from
 * zero when it is shown.
 */
function StoryViewer({ authors, start, onSeenAuthor, onClose }: {
  authors: StoryTrayItem[];
  start: number;
  onSeenAuthor: (userId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const s = t.common.stories;
  const ref = useRef<HTMLDialogElement>(null);
  const [cache, setCache] = useState<Record<string, Loaded>>({});
  // story: -1 = "wherever this author's first unseen story is", resolved on load.
  const [pos, setPos] = useState<StoryPos>({ author: start, story: -1 });
  const [progress, setProgress] = useState(0);
  const elapsed = useRef(0);
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const author = authors[pos.author];
  const list = author ? cache[author.user_id] : undefined;
  const stories = Array.isArray(list) ? list : null;
  const story = stories && pos.story >= 0 ? stories[pos.story] ?? null : null;
  const isMe = author?.is_me ?? false;

  // ---- closing: Escape, the close button and the back button are one path ----
  const pushed = useRef(false);
  // The parent passes a fresh function each render; the viewer is opened once.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const requestClose = useCallback(() => {
    if (pushed.current) window.history.back(); // popstate below does the closing
    else closeRef.current();
  }, []);

  useEffect(() => {
    // Guards, because a development double-mount would otherwise open the
    // dialog twice (which throws) and push two history entries.
    if (!ref.current?.open) ref.current?.showModal();
    // One history entry for the open viewer, keeping the router's own state,
    // so the phone's back button closes it instead of leaving the feed.
    if (!pushed.current) {
      window.history.pushState({ ...(window.history.state ?? {}), voinicStory: true }, "");
      pushed.current = true;
    }
    const onPop = () => {
      pushed.current = false;
      closeRef.current();
    };
    const onVisibility = () => setHidden(document.hidden);
    window.addEventListener("popstate", onPop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // ---- load each author as the viewer reaches them ----
  useEffect(() => {
    if (!author || list !== undefined) return;
    let alive = true;
    loadStories(author.user_id).then((r) => {
      if (alive) setCache((c) => ({ ...c, [author.user_id]: r.ok ? r.stories : "error" }));
    });
    return () => { alive = false; };
  }, [author, list]);

  // ---- moving ----
  const counts = authors.map((a) => {
    const l = cache[a.user_id];
    return Array.isArray(l) ? l.length : a.stories;
  });
  const go = useCallback((next: StoryPos | null, crossing: boolean) => {
    setConfirmDelete(false);
    setViewersOpen(false);
    setError(null);
    if (!next) return requestClose();
    setPos(crossing ? { author: next.author, story: -1 } : next);
  }, [requestClose]);
  const goNext = useCallback(() => {
    const next = nextStoryPos({ author: pos.author, story: Math.max(pos.story, 0) }, counts);
    go(next, next !== null && next.author !== pos.author);
  }, [pos, counts, go]);
  const goPrev = useCallback(() => {
    const prev = prevStoryPos({ author: pos.author, story: Math.max(pos.story, 0) }, counts);
    if (!prev) {
      // Nothing before the first story: start it again.
      elapsed.current = 0;
      setProgress(0);
      return;
    }
    go(prev, false);
  }, [pos, counts, go]);
  const nextRef = useRef(goNext);
  nextRef.current = goNext;

  // Resolve "first unseen" once the author's stories are here; skip an author
  // whose stories all expired between the tray and now.
  useEffect(() => {
    if (!stories) return;
    if (stories.length === 0) nextRef.current();
    else if (pos.story < 0) setPos((p) => ({ ...p, story: firstUnseenIndex(stories) }));
  }, [stories, pos.story]);

  // ---- seen ----
  useEffect(() => {
    if (!story || !author || isMe || story.seen) return;
    const who = author.user_id;
    const updated = (stories ?? []).map((x) => (x.id === story.id ? { ...x, seen: true } : x));
    setCache((c) => ({ ...c, [who]: updated }));
    if (updated.every((x) => x.seen)) onSeenAuthor(who);
    markStorySeen(story.id).then((r) => {
      if (!r.ok && r.expired) {
        // Expired while on screen: drop it, and move on.
        setCache((c) => {
          const l = c[who];
          return Array.isArray(l) ? { ...c, [who]: l.filter((x) => x.id !== story.id) } : c;
        });
      }
    });
    // Only when a new story comes on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  // ---- the clock ----
  const duration = story ? storyDurationMs(story.body) : 0;
  const stopped = !story || held || paused || hidden || viewersOpen || confirmDelete || deleting;
  useEffect(() => {
    elapsed.current = 0;
    setProgress(0);
  }, [story?.id]);
  useEffect(() => {
    if (stopped) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      elapsed.current += now - last;
      last = now;
      const p = Math.min(1, elapsed.current / duration);
      setProgress(p);
      if (p >= 1) {
        nextRef.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stopped, duration, story?.id]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewersOpen) return;
      if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      else if (e.key === " " && e.target === ref.current) { e.preventDefault(); setPaused((v) => !v); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, viewersOpen]);

  // Hold to pause: a press that lasts is a pause, not a tap.
  const pressAt = useRef(0);
  const zone = (dir: "prev" | "next") => ({
    onPointerDown: () => { pressAt.current = performance.now(); setHeld(true); },
    onPointerUp: () => setHeld(false),
    onPointerCancel: () => setHeld(false),
    onPointerLeave: () => setHeld(false),
    onClick: (e: React.MouseEvent) => {
      // A keyboard press has no pointer-down (detail 0) and is always a tap.
      if (e.detail !== 0 && performance.now() - pressAt.current > 300) return;
      if (dir === "prev") goPrev();
      else goNext();
    },
  });

  const total = stories?.length ?? author?.stories ?? 0;

  return (
    <dialog
      ref={ref}
      aria-label={s.viewer}
      onCancel={(e) => { e.preventDefault(); if (viewersOpen) setViewersOpen(false); else requestClose(); }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-black p-0 text-white backdrop:bg-black"
    >
      <div className="story-enter flex h-full w-full items-center justify-center sm:py-6">
        <div
          className={`relative flex h-full w-full flex-col overflow-hidden sm:aspect-[9/16] sm:h-full sm:max-h-[860px] sm:w-auto sm:rounded-3xl ${
            story ? TONE[story.background] : "bg-story-night text-story-night-ink"
          }`}
        >
          {/* progress, one bar per story */}
          <div className="flex gap-1 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]" aria-hidden>
            {Array.from({ length: Math.max(total, 1) }, (_, i) => {
              const fillW = i < pos.story ? 1 : i === pos.story ? progress : 0;
              return (
                <span key={i} className="relative h-[3px] flex-1 overflow-hidden rounded-full">
                  <span className="absolute inset-0 bg-current opacity-25" />
                  <span className="absolute inset-y-0 left-0 bg-current" style={{ width: `${fillW * 100}%` }} />
                </span>
              );
            })}
          </div>
          {story ? (
            <p className="sr-only" aria-live="polite">
              {fill(s.progress, { n: pos.story + 1, total })}
            </p>
          ) : null}

          {/* header */}
          <div className="relative z-10 flex items-center gap-2.5 px-3 pt-2.5">
            {author ? <Avatar name={author.name} url={author.avatar_url} size="h-8 w-8" /> : null}
            <p className="min-w-0 flex-1 truncate text-[13.5px]">
              <span className="font-semibold">{author?.name}</span>
              {story ? (
                <time dateTime={story.created_at} className="ml-2 opacity-70">{f.when(story.created_at)}</time>
              ) : null}
            </p>
            <button
              type="button"
              onClick={() => setPaused((v) => !v)}
              aria-label={paused ? s.resume : s.pause}
              aria-pressed={paused}
              className="grid h-11 w-11 place-items-center rounded-full hover:bg-current/10 focus-visible:outline-2 focus-visible:outline-current"
            >
              <NavIcon d={paused ? PLAY : PAUSE} className="h-5 w-5 [stroke-width:2.2]" />
            </button>
            <button
              type="button"
              onClick={requestClose}
              aria-label={s.close}
              autoFocus
              className="grid h-11 w-11 place-items-center rounded-full hover:bg-current/10 focus-visible:outline-2 focus-visible:outline-current"
            >
              <NavIcon d={CLOSE} className="h-6 w-6 [stroke-width:2.2]" />
            </button>
          </div>

          {/* the story */}
          <div className="relative flex flex-1 items-center justify-center px-8 pb-8">
            {list === "error" ? (
              <p className="text-center text-[14px] opacity-80">{s.loadFailed}</p>
            ) : story ? (
              <p className="whitespace-pre-wrap break-words text-center font-display text-[26px] font-extrabold leading-[1.2] tracking-tight sm:text-[30px]">
                {story.body}
              </p>
            ) : (
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-current border-r-transparent opacity-60 motion-reduce:animate-none" aria-hidden />
            )}
            {/* tap zones: left third back, the rest forward */}
            <button type="button" aria-label={s.previous} className="absolute inset-y-0 left-0 w-1/3 focus-visible:outline-none" {...zone("prev")} />
            <button type="button" aria-label={s.next} className="absolute inset-y-0 right-0 w-2/3 focus-visible:outline-none" {...zone("next")} />
          </div>

          {/* your own story: who saw it, and delete */}
          {isMe && story ? (
            <div className="relative z-10 flex items-center justify-between gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => setViewersOpen(true)}
                className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-[13px] font-semibold hover:bg-current/10 focus-visible:outline-2 focus-visible:outline-current"
              >
                <NavIcon d={EYE} className="h-5 w-5" />
                {story.view_count === 0 ? s.seenByNone
                  : story.view_count === 1 ? s.seenByOne
                  : fill(s.seenBy, { count: story.view_count ?? 0 })}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  if (!confirmDelete) { setConfirmDelete(true); return; }
                  startDelete(async () => {
                    const r = await deleteStory(story.id);
                    if (!r.ok) { setError(s.deleteFailed); setConfirmDelete(false); return; }
                    const left = (stories ?? []).filter((x) => x.id !== story.id);
                    setConfirmDelete(false);
                    setCache((c) => ({ ...c, [author!.user_id]: left }));
                    if (left.length === 0) goNext();
                    else setPos((p) => ({ ...p, story: Math.min(p.story, left.length - 1) }));
                  });
                }}
                className={`inline-flex h-11 items-center gap-2 rounded-full px-3 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-current disabled:opacity-50 ${
                  confirmDelete ? "bg-risk text-white" : "hover:bg-current/10"
                }`}
              >
                <NavIcon d={TRASH} className="h-5 w-5" />
                {confirmDelete ? s.deleteConfirm : <span className="sr-only">{s.delete}</span>}
              </button>
            </div>
          ) : null}
          {error ? <p role="status" className="px-4 pb-3 text-center text-[12.5px]">{error}</p> : null}

          {viewersOpen && story ? <ViewersSheet storyId={story.id} onClose={() => setViewersOpen(false)} /> : null}
        </div>
      </div>
    </dialog>
  );
}

/** Who saw one of your stories — a sheet over the story, which stays paused under it. */
function ViewersSheet({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const s = t.common.stories;
  const [rows, setRows] = useState<StoryViewerRow[] | "error" | null>(null);

  useEffect(() => {
    let alive = true;
    loadStoryViewers(storyId).then((r) => { if (alive) setRows(r.ok ? r.viewers : "error"); });
    return () => { alive = false; };
  }, [storyId]);

  return (
    <div role="dialog" aria-label={s.viewers} className="absolute inset-x-0 bottom-0 z-20 max-h-[60%] overflow-y-auto rounded-t-3xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-[16px] font-bold tracking-tight">{s.viewers}</p>
        <button type="button" onClick={onClose} aria-label={t.common.actions.close} className="grid h-11 w-11 place-items-center rounded-full hover:bg-bg">
          <NavIcon d={CLOSE} className="h-5 w-5" />
        </button>
      </div>
      {rows === null ? (
        <p className="py-6 text-center text-sm text-ink-faint">{t.common.actions.loading}</p>
      ) : rows === "error" ? (
        <p className="py-6 text-center text-sm text-ink-faint">{s.loadFailed}</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-faint">{s.seenByNone}</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {rows.map((r) => (
            <li key={r.user_id} className="flex min-h-12 items-center gap-3">
              <Avatar name={r.name} url={r.avatar_url} size="h-9 w-9" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</span>
              <span className="shrink-0 text-[12px] text-ink-faint">{f.when(r.viewed_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- the composer ----------

/**
 * A new story: a few words on one of three backgrounds, previewed as it will
 * look. Text only in this first version; it lives 24 hours, cannot be
 * edited once shared, and can be deleted from the viewer.
 */
function StoryComposer({ me, onClose }: { me: Me; onClose: (published: boolean) => void }) {
  const { t } = useI18n();
  const s = t.common.stories;
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [bg, setBg] = useState<StoryBackground>("gold");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const done = useRef(false);

  const box = useRef<HTMLTextAreaElement>(null);
  // showModal() moves focus to the dialog's first control (the close button),
  // after React's autoFocus has already run — so the box is focused after it.
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
    box.current?.focus();
  }, []);
  const close = (published: boolean) => {
    done.current = published;
    ref.current?.close();
  };

  return (
    <dialog
      ref={ref}
      aria-label={s.newStory}
      onClose={() => onClose(done.current)}
      onClick={(e) => { if (e.target === e.currentTarget) close(false); }}
      className="app-dialog m-auto w-[calc(100%-1.5rem)] max-w-sm rounded-3xl bg-surface p-0 text-ink"
    >
      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const r = await publishStory(text, bg);
            if (!r.ok) { setError(r.message ?? s.failed); return; }
            close(true);
          });
        }}
      >
        <div className="flex items-center gap-2.5">
          <Avatar name={me.name} url={me.avatar_url} size="h-8 w-8" />
          <p className="flex-1 font-display text-[16px] font-bold tracking-tight">{s.newStory}</p>
          <button type="button" onClick={() => close(false)} aria-label={s.cancel} className="grid h-11 w-11 place-items-center rounded-full text-ink-soft hover:bg-bg hover:text-ink">
            <NavIcon d={CLOSE} className="h-5 w-5" />
          </button>
        </div>

        {/* The preview is the editor: what you type is what they will see. */}
        <div className={`mt-3 flex aspect-[4/5] items-center rounded-2xl px-5 ${TONE[bg]}`}>
          <textarea
            ref={box}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, STORY_TEXT_MAX))}
            maxLength={STORY_TEXT_MAX}
            rows={5}
            placeholder={s.placeholder}
            aria-label={s.placeholder}
            className="w-full resize-none bg-transparent text-center font-display text-[22px] font-extrabold leading-[1.2] tracking-tight outline-none placeholder:text-current placeholder:opacity-50"
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div role="radiogroup" aria-label={s.background} className="flex gap-2">
            {STORY_BACKGROUNDS.map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={bg === b}
                aria-label={s.backgrounds[b]}
                title={s.backgrounds[b]}
                onClick={() => setBg(b)}
                className={`grid h-11 w-11 place-items-center rounded-full ${bg === b ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
              >
                <span className={`block h-8 w-8 rounded-full border border-line ${TONE[b]}`} />
              </button>
            ))}
          </div>
          <span className="text-[11px] tabular-nums text-ink-faint">{text.length}/{STORY_TEXT_MAX}</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">{s.audience}</p>
        {error ? <p role="status" className="mt-2 text-[12.5px] text-risk">{error}</p> : null}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => close(false)} className="h-11 rounded-2xl px-4 text-[13px] font-semibold text-ink-soft hover:bg-bg hover:text-ink">
            {s.cancel}
          </button>
          <button
            type="submit"
            disabled={pending || text.trim().length === 0}
            className="h-11 rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {s.publish}
          </button>
        </div>
      </form>
    </dialog>
  );
}
