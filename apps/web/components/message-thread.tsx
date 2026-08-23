"use client";
import { useState, useTransition } from "react";
import type { MessageRow } from "@/lib/types";
import { sendMessage } from "@/app/actions";

export function MessageThread({
  conversationId,
  initialMessages,
}: {
  conversationId: string;
  initialMessages: MessageRow[];
}) {
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
        if (result.demo) setNote("Demo mode — message not persisted.");
      } else {
        setNote(result.message ?? "Could not send");
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto py-2">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[80%] rounded-xl border px-3 py-2 text-sm ${
              m.mine
                ? "self-end border-accent-soft bg-accent-soft"
                : "self-start border-line bg-surface"
            }`}
          >
            {m.body}
          </div>
        ))}
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-soft">No messages yet — say hi.</p>
        ) : null}
      </div>
      {note ? <p className="pb-1 text-xs text-ink-faint">{note}</p> : null}
      <div className="flex gap-2 pt-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Message…"
          className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={send}
          disabled={pending || !draft.trim()}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
