"use client";
import { useState, useTransition } from "react";
import type { MessageRow } from "@/lib/types";
import { sendMessage } from "@/app/actions";
import { useI18n } from "@/lib/i18n/client";

export function MessageThread({
  conversationId,
  initialMessages,
}: {
  conversationId: string;
  initialMessages: MessageRow[];
}) {
  const { t } = useI18n();
  const msgs = t.coachWidgets.messageThread;
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      } else {
        setNote(result.message ?? msgs.couldNotSend);
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto py-1">
        {messages.map((m) => (
          <div
            key={m.id}
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
          <p className="py-8 text-center text-[13px] text-ink-faint">{msgs.noMessages}</p>
        ) : null}
      </div>
      {note ? <p className="pb-1 text-[12.5px] text-ink-faint">{note}</p> : null}
      <div className="flex gap-2 pt-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={msgs.placeholder}
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
    </div>
  );
}
