"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import type { ConversationContext, MessageRow } from "@/lib/types";
import { markConversationRead, sendMessage } from "@/app/actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { Avatar } from "./social";

export function MessageThread({
  conversationId,
  initialMessages,
  closed = false,
  firstMessageHint = false,
}: {
  conversationId: string;
  initialMessages: MessageRow[];
  /** The pair may no longer write (conversation_open() is false): history only, no composer. */
  closed?: boolean;
  /** An empty thread that came from a request: the request is on screen, say so. */
  firstMessageHint?: boolean;
}) {
  const { t } = useI18n();
  const msgs = t.coachWidgets.messageThread;
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [isClosed, setIsClosed] = useState(closed);
  const [pending, startTransition] = useTransition();

  // On screen is read: the other side's messages and this thread's notice
  // (mark_conversation_read). Only when there is something unread to stamp.
  const hasUnread = initialMessages.some((m) => !m.mine);
  useEffect(() => {
    if (hasUnread) void markConversationRead(conversationId);
  }, [conversationId, hasUnread]);

  function send() {
    const body = draft.trim();
    if (!body) return;
    setNote(null);
    startTransition(async () => {
      const result = await sendMessage(conversationId, body);
      if (result.ok) {
        setMessages((prev) => [
          ...prev,
          { id: `local-${Date.now()}`, mine: true, body, at: new Date().toISOString() },
        ]);
        setDraft("");
      } else if (result.errorCode === "CONVERSATION_CLOSED") {
        setIsClosed(true);
      } else {
        setNote(result.message ?? msgs.couldNotSend);
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="message-thread">
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto py-1">
        {messages.map((m) => (
          <div
            key={m.id}
            data-testid="message"
            data-mine={m.mine ? "true" : "false"}
            className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
              m.mine
                ? "self-end bg-accent-soft text-ink"
                : "self-start bg-surface text-ink"
            }`}
          >
            {m.body}
          </div>
        ))}
        {messages.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-faint">
            {firstMessageHint && !isClosed ? msgs.firstMessageHint : msgs.noMessages}
          </p>
        ) : null}
      </div>
      {note ? <p className="pb-1 text-[12.5px] text-ink-faint">{note}</p> : null}
      {isClosed ? (
        <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-[13px] text-ink-soft" data-testid="thread-closed">
          {msgs.closed}
        </p>
      ) : (
        <div className="flex gap-2 pt-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={msgs.placeholder}
            aria-label={msgs.placeholder}
            // An empty thread is opened to write in it: the composer is ready.
            autoFocus={initialMessages.length === 0}
            maxLength={4000}
            className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={send}
            disabled={pending || !draft.trim()}
            className="flex h-11 shrink-0 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {t.common.actions.send}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Who the thread is with and why it exists (conversation_context()): the
 * other person, where things stand, and — for a thread that began as a
 * contact request — the request itself, so nobody writes it a second time.
 */
export function ThreadHeader({ context, expanded = false }: { context: ConversationContext; expanded?: boolean }) {
  const { t, locale } = useI18n();
  const msgs = t.coachWidgets.messageThread;
  const r = t.coachProfile.requests;
  const deliveries = t.coachProfile.services.deliveries;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" }).format(new Date(iso));
  const req = context.request;
  // A coach's own page for the client; the person's profile for the coach.
  const profileHref = context.side === "client" && context.coach_slug
    ? `/coaches/${context.coach_slug}`
    : `/people/${context.other_id}`;

  return (
    <div className="space-y-3" data-testid="thread-header" data-relationship={context.relationship}>
      <div className="flex items-center gap-3">
        <Avatar name={context.other_name} url={context.other_avatar} size="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{context.other_name}</h1>
          <p className="text-[12.5px] text-ink-faint">
            {msgs.relationship[context.relationship]}
            {" · "}
            <Link href={profileHref} className="font-semibold hover:text-ink">{msgs.profile}</Link>
          </p>
        </div>
      </div>
      {req && context.relationship === "request" ? (
        <details className="rounded-2xl bg-surface px-4 py-3 text-[13px]" open={expanded} data-testid="thread-request">
          <summary className="cursor-pointer font-semibold text-ink-soft">
            {msgs.fromRequest}
            {" · "}
            {req.resolved_at ? fill(msgs.acceptedOn, { date: date(req.resolved_at) }) : fill(msgs.sentOn, { date: date(req.created_at) })}
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5 text-[12.5px]">
            {req.service_name ? <li className="rounded-full bg-bg px-2.5 py-1 font-semibold text-ink-soft">{fill(r.service, { name: req.service_name })}</li> : null}
            {req.preferred_format ? <li className="rounded-full bg-bg px-2.5 py-1 font-semibold text-ink-soft">{fill(r.format, { format: deliveries[req.preferred_format] })}</li> : null}
          </ul>
          {req.goal ? <p className="mt-2 font-semibold">{fill(r.goal, { goal: req.goal })}</p> : null}
          {req.message ? <p className="mt-1.5 whitespace-pre-line leading-relaxed text-ink-soft">{req.message}</p> : null}
        </details>
      ) : null}
    </div>
  );
}
