"use client";
import { settle } from "@/lib/settle-action";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { displayToKg, GOAL_METRIC_SPEC, kgToDisplay, parseDecimal } from "@healthapp/shared";
import { submitCheckIn } from "@/app/client-actions-body";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { Card } from "./ui";
import { useOfflineOutbox } from "@/lib/offline/sync";
import type { CheckInQuestion } from "@/lib/check-in-questions";

const SCALES = ["sleep", "energy", "stress", "hunger", "recovery"] as const;

type ScaleKey = (typeof SCALES)[number];

type AnswerValue = number | boolean | string;

export function CheckInForm({ questions = [] }: { questions?: CheckInQuestion[] }) {
  const { t } = useI18n();
  const u = useUnits();
  const router = useRouter();
  const [weight, setWeight] = useState("");
  const [scores, setScores] = useState<Record<ScaleKey, number>>({
    sleep: 5,
    energy: 5,
    stress: 5,
    hunger: 5,
    recovery: 5,
  });
  const [note, setNote] = useState("");
  // the coach's own questions: unanswered ones are simply not sent
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const offline = useOfflineOutbox();
  const [pending, startTransition] = useTransition();

  return (
    <Card plain>
      <div className="space-y-5">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {fill(t.clientWidgets.checkInForm.weightKg, { unit: u.weightUnit })}
          </span>
          <input
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder={t.clientWidgets.checkInForm.optional}
            className="mt-1.5 h-11 w-36 rounded-xl border border-line bg-bg px-3 text-sm tabular-nums outline-none focus:border-accent"
          />
        </label>

        {/* The five scales, each a label + its value + the slider under them. */}
        <div className="rounded-2xl bg-bg px-4 py-3.5">
          <div className="divide-y divide-line/60">
            {SCALES.map((scale) => (
              <div key={scale} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold">{t.clientWidgets.checkInForm.scales[scale]}</span>
                  <span className="font-display text-base font-bold tabular-nums text-accent-ink">
                    {scores[scale]}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={scores[scale]}
                  aria-label={t.clientWidgets.checkInForm.scales[scale]}
                  onChange={(e) =>
                    setScores((prev) => ({ ...prev, [scale]: Number(e.target.value) }))
                  }
                  className="mt-2 w-full"
                />
              </div>
            ))}
          </div>
        </div>

        {questions.length > 0 ? (
          <div className="rounded-2xl bg-bg px-4 py-3.5" data-testid="check-in-coach-questions">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{t.clientWidgets.checkInForm.coachQuestions}</p>
            <div className="mt-1 divide-y divide-line/60">
              {questions.map((q) => (
                <QuestionField key={q.id} question={q} value={answers[q.id]}
                  onChange={(v) => setAnswers((prev) => {
                    const next = { ...prev };
                    if (v === null) delete next[q.id]; else next[q.id] = v;
                    return next;
                  })} />
              ))}
            </div>
          </div>
        ) : null}

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {t.clientWidgets.checkInForm.coachNote}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1.5 w-full resize-y rounded-xl border border-line bg-bg px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-accent"
          />
        </label>

        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              // Typed in the reader's unit; check_ins.weight_kg is metric.
              const typed = parseDecimal(weight);
              const parsed = typed === null ? null : displayToKg(typed, u.weightUnit);
              // the same range submitCheckIn holds (measurements.weight_kg's check), said in the reader's unit
              const range = GOAL_METRIC_SPEC.body_weight;
              if ((weight.trim() !== "" && typed === null) || (parsed !== null && !(parsed >= range.min && parsed <= range.max))) {
                setError(fill(t.clientWidgets.checkInForm.weightRange, { min: kgToDisplay(range.min, u.weightUnit), max: kgToDisplay(range.max, u.weightUnit), unit: u.weightUnit }));
                return;
              }
              const input = {
                weightKg: parsed, ...scores, note,
                answers: Object.entries(answers).map(([questionId, value]) => ({ questionId, value })),
              };
              // No connection: the check-in waits on this phone and is sent by itself.
              if (navigator.onLine === false && offline) {
                if (await offline.queueAction({ kind: "checkin", input })) { setNotice(t.clientWidgets.checkInForm.savedOnPhone); return; }
              }
              let result: Awaited<ReturnType<typeof submitCheckIn>>;
              try {
                result = await submitCheckIn(input);
              } catch {
                if (offline && (await offline.queueAction({ kind: "checkin", input }))) { setNotice(t.clientWidgets.checkInForm.savedOnPhone); return; }
                result = await settle(() => submitCheckIn(input), t.common.actions.unreachable);
              }
              if (!result.ok) {
                setError(result.message ?? t.clientWidgets.checkInForm.couldNotSubmit);
                return;
              }
              router.refresh();
            })
          }
          className="flex h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {t.clientWidgets.checkInForm.submit}
        </button>

        {error ? <p className="text-[13px] font-semibold text-risk">{error}</p> : null}
        {notice ? <p role="status" className="text-[13px] font-semibold text-warn">{notice}</p> : null}
      </div>
    </Card>
  );
}

/** One coach question, answered the way its kind asks. */
function QuestionField({ question, value, onChange }: {
  question: CheckInQuestion; value: AnswerValue | undefined; onChange: (v: AnswerValue | null) => void;
}) {
  const { t } = useI18n();
  const f = t.clientWidgets.checkInForm;
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{question.prompt}</span>
        {question.kind === "scale" ? (
          <span className="font-display text-base font-bold tabular-nums text-accent-ink">{typeof value === "number" ? value : "—"}</span>
        ) : null}
      </div>
      {question.kind === "scale" ? (
        <input type="range" min={1} max={10} value={typeof value === "number" ? value : 5} aria-label={question.prompt}
          onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full" />
      ) : question.kind === "number" ? (
        <input inputMode="decimal" aria-label={question.prompt} value={typeof value === "number" ? String(value) : ""}
          onChange={(e) => { const n = parseDecimal(e.target.value); onChange(e.target.value.trim() === "" || n === null ? null : n); }}
          placeholder={f.optional}
          className="mt-1.5 h-10 w-36 rounded-xl border border-line bg-surface px-3 text-sm tabular-nums outline-none focus:border-accent" />
      ) : question.kind === "yes_no" ? (
        <div className="mt-1.5 flex gap-1.5" role="radiogroup" aria-label={question.prompt}>
          {[true, false].map((b) => (
            <button key={String(b)} type="button" role="radio" aria-checked={value === b}
              onClick={() => onChange(value === b ? null : b)}
              className={`h-9 rounded-full px-4 text-[13px] font-semibold ${value === b ? "bg-accent text-accent-fg" : "border border-line bg-surface text-ink-soft"}`}>
              {b ? f.yes : f.no}
            </button>
          ))}
        </div>
      ) : (
        <textarea aria-label={question.prompt} rows={2} maxLength={1000} value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value.trim() ? e.target.value : null)}
          className="mt-1.5 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      )}
    </div>
  );
}
