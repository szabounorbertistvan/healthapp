"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCheckInQuestion, deleteCheckInQuestion, setCheckInQuestionActive } from "@/app/check-in-question-actions";
import { settle } from "@/lib/settle-action";
import { useI18n } from "@/lib/i18n/client";
import { FIELD, SMALL_BUTTON } from "@/lib/form-classes";
import type { CoachCheckInQuestion, CheckInQuestionKind } from "@/lib/check-in-questions";
import { Card, Switch } from "./ui";

const KINDS: CheckInQuestionKind[] = ["scale", "number", "yes_no", "text"];

/**
 * The coach's own check-in questions (20261207120000), above the review queue:
 * what is asked every week on top of the five fixed scales, for all clients or
 * one. An answered question can only be switched off, so old answers keep it.
 */
export function CheckInQuestionsEditor({ questions, clients }: {
  questions: CoachCheckInQuestion[];
  clients: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.checkInQuestions;
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<CheckInQuestionKind>("scale");
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(questions.length === 0);

  const say = (message: string | undefined) =>
    setError(message === "LIMIT" ? m.limit : message === "ANSWERED" ? m.answered : message ?? m.failed);

  function add() {
    if (!prompt.trim()) { setError(m.promptRequired); return; }
    setError(null);
    start(async () => {
      const r = await settle(() => addCheckInQuestion({ prompt: prompt.trim(), kind, clientId: clientId || null }), t.common.actions.unreachable);
      if (!r.ok) { say(r.message); return; }
      setPrompt("");
      router.refresh();
    });
  }

  const run = (call: () => Promise<{ ok: boolean; message?: string }>) => start(async () => {
    setError(null);
    const r = await settle(call, t.common.actions.unreachable);
    if (!r.ok) say(r.message); else router.refresh();
  });

  const active = questions.filter((q) => q.active).length;

  return (
    <Card plain>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left">
        <span>
          <span className="block font-display text-lg font-bold tracking-tight">{m.title}</span>
          <span className="mt-0.5 block text-[12.5px] text-ink-soft">{questions.length ? `${active}/12 · ${m.lead}` : m.lead}</span>
        </span>
        <span aria-hidden className="text-ink-faint">{open ? "−" : "+"}</span>
      </button>

      {open ? (
        <div className="mt-4 grid gap-4">
          {questions.length > 0 ? (
            <ul className="divide-y divide-line/60">
              {questions.map((q) => (
                <li key={q.id} className={`flex flex-wrap items-center gap-3 py-2.5 ${q.active ? "" : "opacity-60"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold">{q.prompt}</p>
                    <p className="text-[12px] text-ink-faint">{m.kinds[q.kind]} · {q.client_name ?? m.allClients}</p>
                  </div>
                  <Switch checked={q.active} label={m.activeLabel} onChange={(on) => run(() => setCheckInQuestionActive(q.id, on))}
                    onLabel={m.on} offLabel={m.off} />
                  <button type="button" disabled={pending} onClick={() => run(() => deleteCheckInQuestion(q.id))}
                    className="text-[12px] font-semibold text-ink-faint hover:text-risk">{m.remove}</button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-2 rounded-2xl bg-bg p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
            <label className="text-[12.5px] font-semibold text-ink-soft">
              {m.prompt}
              <input id="ciq-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={200}
                placeholder={m.promptPlaceholder} className={`${FIELD} bg-surface`} />
            </label>
            <label className="text-[12.5px] font-semibold text-ink-soft">
              {m.kind}
              <select id="ciq-kind" value={kind} onChange={(e) => setKind(e.target.value as CheckInQuestionKind)} className={`${FIELD} bg-surface`}>
                {KINDS.map((k) => <option key={k} value={k}>{m.kinds[k]}</option>)}
              </select>
            </label>
            <label className="text-[12.5px] font-semibold text-ink-soft">
              {m.forWhom}
              <select id="ciq-client" value={clientId} onChange={(e) => setClientId(e.target.value)} className={`${FIELD} bg-surface`}>
                <option value="">{m.allClients}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button type="button" onClick={add} disabled={pending} className={`${SMALL_BUTTON} h-11 px-4`}>{m.add}</button>
          </div>
          {error ? <p role="alert" className="text-[12.5px] font-semibold text-risk">{error}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
