"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COMMENT_MAX, applyMention, commentSegments, mentionQueryAt } from "@healthapp/shared";
import { addComment, deleteComment, loadComments, mentionCandidates } from "@/app/social-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";
import { Avatar, useSocialFormat } from "./social";
import { NavIcon } from "./client-nav";
import type { CommentPage, CommentThread as Thread, PersonRow, PostComment } from "@/lib/types";

/**
 * A post's conversation: top-level comments, one level of replies under each,
 * and a composer that suggests people as you type "@".
 *
 * Replies stop at one level on purpose — the database refuses a deeper one
 * (social_comment_depth_guard), and a thread that nests further is a thread
 * nobody can read on a 375px phone.
 */
export function CommentThread({ postId, page }: { postId: string; page: CommentPage }) {
  const { t } = useI18n();
  const router = useRouter();
  const s = t.common.social;
  const [threads, setThreads] = useState<Thread[]>(page.items);
  const [cursor, setCursor] = useState<string | null>(page.next_cursor);
  const [replyTo, setReplyTo] = useState<{ id: string; username: string | null } | null>(null);
  const [pending, startTransition] = useTransition();

  // The server is the truth after any write; this keeps the list in step when
  // a refresh brings a new page down.
  useEffect(() => {
    setThreads(page.items);
    setCursor(page.next_cursor);
  }, [page]);

  const total = threads.reduce((sum, c) => sum + 1 + c.replies.length, 0);

  return (
    <Card plain className="p-5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        <NavIcon d="M4 5h16v11H9l-5 4z" className="h-[15px] w-[15px]" />
        {total === 1 ? s.commentOne : fill(s.commentsCount, { count: total })}
      </p>

      {threads.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-faint">{s.noComments}</p>
      ) : (
        <ul className="mt-3.5 space-y-4">
          {threads.map((c) => (
            <li key={c.id}>
              <CommentRow
                comment={c}
                postId={postId}
                onReply={() => setReplyTo({ id: c.id, username: c.author_username })}
              />
              {c.replies.length > 0 ? (
                /* Indented once and only once — the left rule is the thread. */
                <ul className="mt-3 space-y-3 border-l border-line/70 pl-3 sm:pl-4">
                  {c.replies.map((r) => (
                    <li key={r.id}>
                      <CommentRow
                        comment={r}
                        postId={postId}
                        onReply={() => setReplyTo({ id: c.id, username: r.author_username })}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const more = await loadComments(postId, cursor);
              setThreads((current) => [...current, ...more.items]);
              setCursor(more.next_cursor);
            })
          }
          className="mt-3.5 inline-flex h-9 items-center rounded-full bg-bg px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
        >
          {s.loadMoreComments}
        </button>
      ) : null}

      <CommentComposer
        postId={postId}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onPosted={() => {
          setReplyTo(null);
          router.refresh();
        }}
      />
    </Card>
  );
}

/** One comment: who, when, what — and the controls its owner gets. */
function CommentRow({
  comment, postId, onReply,
}: {
  comment: PostComment;
  postId: string;
  onReply: () => void;
}) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const router = useRouter();
  const s = t.common.social;
  const [pending, startTransition] = useTransition();

  return (
    <div id={`comment-${comment.id}`} className="flex items-start gap-2.5 scroll-mt-24">
      <Avatar name={comment.author_name} url={comment.author_avatar} size="h-8 w-8" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <Link href={`/people/${comment.user_id}`} className="truncate text-[13px] font-semibold hover:text-accent-ink">
            {comment.author_name}
          </Link>
          <span className="shrink-0 text-[12px] text-ink-faint">{f.when(comment.created_at)}</span>
        </div>
        <CommentBody comment={comment} />
        <div className="mt-1 flex items-center gap-3">
          <button type="button" onClick={onReply} className="text-[11px] font-semibold text-ink-faint hover:text-accent-ink">
            {s.reply}
          </button>
          {comment.mine ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteComment(comment.id, postId);
                  router.refresh();
                })
              }
              className="text-[11px] font-semibold text-ink-faint hover:text-risk disabled:opacity-50"
            >
              {s.deleteComment}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The body, rendered as elements rather than as a string.
 *
 * A handle becomes a link only when `mentions` carries a row for it — the
 * database decides, not the text. There is no HTML anywhere in this path, so
 * a comment containing markup is shown as the characters somebody typed.
 */
function CommentBody({ comment }: { comment: PostComment }) {
  const segments = commentSegments(comment.body, comment.mentions);
  return (
    <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed">
      {segments.map((segment, i) =>
        segment.kind === "mention" ? (
          <Link
            key={i}
            href={`/people/${segment.user_id}`}
            className="font-semibold text-accent-ink hover:underline"
          >
            {segment.text}
          </Link>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * Write a comment or a reply, with people suggested as you type "@".
 *
 * The suggestion list is server-side (social_mention_candidates): the client
 * cannot be handed a directory of everyone, and people who can already see the
 * post sort first — mentioning somebody who cannot open it is allowed, it is
 * only text, but it will never notify them.
 */
function CommentComposer({
  postId, replyTo, onCancelReply, onPosted,
}: {
  postId: string;
  replyTo: { id: string; username: string | null } | null;
  onCancelReply: () => void;
  onPosted: () => void;
}) {
  const { t } = useI18n();
  const s = t.common.social;
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<PersonRow[]>([]);
  const [query, setQuery] = useState<{ query: string; start: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Replying pre-fills the handle, which is also what makes the notification
  // land: the reply notifies the parent's author either way, but the mention
  // makes the thread readable.
  useEffect(() => {
    if (replyTo?.username) {
      setBody((current) => (current.startsWith(`@${replyTo.username} `) ? current : `@${replyTo.username} `));
      inputRef.current?.focus();
    }
  }, [replyTo]);

  // Debounced, and only while the caret is inside a handle.
  useEffect(() => {
    if (!query) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSuggestions(await mentionCandidates(query.query, postId));
    }, 180);
    return () => clearTimeout(timer);
  }, [query, postId]);

  function onChange(value: string, caret: number) {
    setBody(value.slice(0, COMMENT_MAX));
    setQuery(mentionQueryAt(value, caret));
  }

  function choose(person: PersonRow) {
    if (!query || !person.username) return;
    const caret = inputRef.current?.selectionStart ?? body.length;
    const next = applyMention(body, query.start, caret, person.username);
    setBody(next.body.slice(0, COMMENT_MAX));
    setQuery(null);
    setSuggestions([]);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  return (
    <div className="mt-4">
      {replyTo ? (
        <p className="mb-2 flex items-center gap-2 text-[12px] text-ink-faint">
          {s.replyingTo}
          <button type="button" onClick={onCancelReply} className="font-semibold text-ink-soft hover:text-ink">
            {s.cancelReply}
          </button>
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        /* Above the field, so the on-screen keyboard does not cover it. */
        <ul className="mb-2 max-h-48 overflow-y-auto rounded-xl border border-line bg-surface p-1">
          {suggestions.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => choose(person)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-bg"
              >
                <Avatar name={person.name} url={person.avatar_url} size="h-7 w-7" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{person.name}</span>
                {person.username ? (
                  <span className="shrink-0 text-[12px] text-ink-faint">@{person.username}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await addComment(postId, body, replyTo?.id ?? null);
            if (!result.ok) {
              setError(result.message ?? s.commentInvalid);
              return;
            }
            setBody("");
            setSuggestions([]);
            setQuery(null);
            onPosted();
          });
        }}
      >
        <input
          ref={inputRef}
          value={body}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyUp={(e) => setQuery(mentionQueryAt(e.currentTarget.value, e.currentTarget.selectionStart ?? 0))}
          onClick={(e) => setQuery(mentionQueryAt(e.currentTarget.value, e.currentTarget.selectionStart ?? 0))}
          placeholder={replyTo ? s.writeReply : s.writeComment}
          maxLength={COMMENT_MAX}
          aria-label={replyTo ? s.writeReply : s.writeComment}
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
    </div>
  );
}
