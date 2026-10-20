"use client";
import { settle } from "@/lib/settle-action";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ConversationContext, MessageRow } from "@/lib/types";
import { markConversationRead, sendMessage } from "@/app/actions";
import { discardMessageUpload, requestMessageUpload, sendMessageWithAttachment } from "@/app/message-actions";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { Avatar } from "./social-chrome";

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
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [isClosed, setIsClosed] = useState(closed);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // The server's list wins whenever it changes (a refresh after a send, or a
  // message from the other side arriving through realtime below).
  useEffect(() => setMessages(initialMessages), [initialMessages]);
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages.length]);

  // Live: a new row in this conversation (Supabase Realtime, which applies
  // msg_select to every change it delivers — 20261207130000) refreshes the
  // thread from the server, so nothing is rendered that a read would not show.
  useEffect(() => {
    let client: ReturnType<typeof supabaseBrowser>;
    try {
      client = supabaseBrowser();
    } catch {
      return;
    }
    const channel = client
      .channel(`thread:${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => {
          router.refresh();
          void markConversationRead(conversationId);
        })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [conversationId, router]);

  /** Upload a picture or a recording with a server-issued ticket, then send it. */
  async function sendAttachment(file: Blob, kind: "image" | "audio") {
    if (file.size > 10 * 1024 * 1024) { setNote(msgs.tooLarge); return; }
    setNote(null);
    setUploading(true);
    try {
      const req = await settle(() => requestMessageUpload({ conversationId, kind }), t.common.actions.unreachable);
      if (!req.ok || !("ticket" in req) || !req.ticket) { setNote(req.message === "NOT_CONFIGURED" ? msgs.attachmentsOff : msgs.couldNotSend); return; }
      const ticket = req.ticket;
      const form = new FormData();
      form.append("file", file);
      form.append("api_key", ticket.apiKey);
      for (const [key, value] of Object.entries(ticket.fields)) form.append(key, value);
      const up = await fetch(`https://api.cloudinary.com/v1_1/${ticket.cloudName}/${ticket.resourceType}/upload`, { method: "POST", body: form }).catch(() => null);
      if (!up?.ok) { setNote(msgs.couldNotSend); return; }
      const body = draft.trim() || null;
      const result = await settle(() => sendMessageWithAttachment({ conversationId, body, attachment: { kind, publicId: ticket.publicId } }), t.common.actions.unreachable);
      if (result.ok) {
        setDraft("");
        router.refresh();
      } else {
        if (result.errorCode === "CONVERSATION_CLOSED") setIsClosed(true);
        else setNote(msgs.couldNotSend);
        void discardMessageUpload(conversationId, ticket.publicId, kind);
      }
    } finally {
      setUploading(false);
    }
  }

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
      const result = await settle(() => sendMessage(conversationId, body), t.common.actions.unreachable);
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
            {m.attachment ? <Attachment messageId={m.id} attachment={m.attachment} /> : null}
            {m.body ? <span className={m.attachment ? "mt-1.5 block whitespace-pre-wrap" : "whitespace-pre-wrap"}>{m.body}</span> : null}
          </div>
        ))}
        <div ref={endRef} />
        {messages.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-faint">
            {firstMessageHint && !isClosed ? msgs.firstMessageHint : msgs.noMessages}
          </p>
        ) : null}
      </div>
      {uploading ? <p className="pb-1 text-[12.5px] text-ink-faint">{msgs.uploading}</p> : null}
      {note ? <p className="pb-1 text-[12.5px] text-ink-faint">{note}</p> : null}
      {isClosed ? (
        <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-[13px] text-ink-soft" data-testid="thread-closed">
          {msgs.closed}
        </p>
      ) : (
        <div className="flex gap-2 pt-3">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void sendAttachment(f, "image"); }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || pending} aria-label={msgs.attachPhoto}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface text-ink-soft hover:border-accent hover:text-ink disabled:opacity-50">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="m21 17-5-5-9 7" />
            </svg>
          </button>
          <VoiceRecorder disabled={uploading || pending} onRecorded={(blob) => void sendAttachment(blob, "audio")} />
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
            disabled={pending || uploading || !draft.trim()}
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

/**
 * A picture or a voice note, fetched from /api/messages/<id>/attachment (which
 * asks the database who may see it). A voice note loads only when played, as a
 * blob: iOS will not play an audio stream without range requests.
 */
function Attachment({ messageId, attachment }: { messageId: string; attachment: NonNullable<MessageRow["attachment"]> }) {
  const { t } = useI18n();
  const msgs = t.coachWidgets.messageThread;
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const src = `/api/messages/${messageId}/attachment`;
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  if (attachment.kind === "image") {
    const ratio = attachment.width && attachment.height ? `${attachment.width} / ${attachment.height}` : undefined;
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, session-checked stream, not an optimisable public image */}
        <img src={src} alt={msgs.photo} loading="lazy" style={{ aspectRatio: ratio }} className="max-h-72 w-full max-w-xs rounded-xl object-cover" />
      </a>
    );
  }
  const secs = attachment.seconds ? Math.round(attachment.seconds) : null;
  return audioUrl ? (
    <audio src={audioUrl} controls autoPlay className="h-10 w-60 max-w-full" />
  ) : (
    <button type="button" disabled={loading}
      onClick={async () => {
        setLoading(true);
        const res = await fetch(src).catch(() => null);
        if (res?.ok) setAudioUrl(URL.createObjectURL(await res.blob()));
        setLoading(false);
      }}
      className="inline-flex h-10 items-center gap-2 rounded-full bg-bg px-3.5 text-[13px] font-semibold">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
      {msgs.voiceNote}{secs ? ` · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : ""}
    </button>
  );
}

/**
 * Tap to record a voice note (MediaRecorder; webm on Chrome/Android, mp4 on
 * Safari), tap again to stop and send. Up to 5 minutes. The microphone is
 * asked for only on the first tap and released as soon as recording stops.
 */
function VoiceRecorder({ disabled, onRecorded }: { disabled: boolean; onRecorded: (blob: Blob) => void }) {
  const { t } = useI18n();
  const msgs = t.coachWidgets.messageThread;
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const supported = typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  async function start() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((x) => MediaRecorder.isTypeSupported(x));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      if (timer.current) window.clearInterval(timer.current);
      setRecording(false);
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      if (blob.size > 0) onRecorded(blob);
    };
    recorder.current = rec;
    rec.start();
    setElapsed(0);
    setRecording(true);
    const began = Date.now();
    timer.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000);
      setElapsed(s);
      if (s >= 300) rec.stop();
    }, 500);
  }

  if (!supported) return null;
  return (
    <button type="button" disabled={disabled} aria-pressed={recording}
      aria-label={recording ? msgs.stopRecording : msgs.recordVoice}
      onClick={() => (recording ? recorder.current?.stop() : void start())}
      className={`flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-2xl px-3 text-[13px] font-semibold tabular-nums disabled:opacity-50 ${
        recording ? "bg-risk text-bg" : "w-11 border border-line bg-surface text-ink-soft hover:border-accent hover:text-ink"
      }`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
      {recording ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}` : null}
    </button>
  );
}
