"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { kgToDisplay } from "@healthapp/shared";
import { addWorkoutFeedback, deleteWorkoutFeedback } from "@/app/workout-feedback-actions";
import { settle } from "@/lib/settle-action";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { FIELD, SMALL_BUTTON } from "@/lib/form-classes";
import type { FeedbackComment, FeedbackSession, FeedbackSet } from "@/lib/workout-feedback";
import { Card } from "./ui";

type Unit = "kg" | "lb";

function setLine(s: FeedbackSet, unit: Unit, t: { seconds: string; reps: string }) {
  const work = s.duration_seconds ? fill(t.seconds, { n: s.duration_seconds }) : fill(t.reps, { n: s.reps });
  const load = s.weight_kg ? `${kgToDisplay(s.weight_kg, unit)} ${unit} × ` : "";
  const effort = s.rir !== null ? ` · RIR ${s.rir}` : s.rpe !== null ? ` · RPE ${s.rpe}` : "";
  return `${load}${work}${effort}`;
}

/** Sets grouped under their exercise, in the order they were done. */
function byExercise(sets: FeedbackSet[]): { exercise: string; sets: FeedbackSet[] }[] {
  const out: { exercise: string; sets: FeedbackSet[] }[] = [];
  for (const s of sets) {
    const last = out[out.length - 1];
    if (last && last.exercise === s.exercise) last.sets.push(s);
    else out.push({ exercise: s.exercise, sets: [s] });
  }
  return out;
}

function Comments({ comments, onDelete, pending }: { comments: FeedbackComment[]; onDelete?: (id: string) => void; pending?: boolean }) {
  const { t, locale } = useI18n();
  const m = t.coachWidgets.workoutFeedback;
  if (comments.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-1.5">
      {comments.map((c) => (
        <li key={c.id} className="rounded-xl bg-accent-soft px-3 py-2 text-[13px] leading-relaxed text-ink">
          <span className="whitespace-pre-wrap">{c.body}</span>
          <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
            {new Date(c.created_at).toLocaleString(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {onDelete && c.mine && Date.now() - new Date(c.created_at).getTime() < 86_400_000 ? (
              <button type="button" disabled={pending} onClick={() => onDelete(c.id)} className="font-semibold hover:text-risk">{m.takeBack}</button>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The coach's view of a client's recent workouts, set by set, with a comment
 * box for the whole workout and a "comment" link on every set. The client is
 * notified and reads it on the workout's own page.
 */
export function ClientWorkoutsFeedback({ clientId, sessions, name }: { clientId: string; sessions: FeedbackSession[]; name: string }) {
  const { t, locale } = useI18n();
  const m = t.coachWidgets.workoutFeedback;
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(sessions[0]?.id ?? null);
  const [target, setTarget] = useState<{ type: "session" | "set"; id: string } | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    if (!target || !body.trim()) return;
    setError(null);
    start(async () => {
      const r = await settle(() => addWorkoutFeedback({ clientId, referenceType: target.type, referenceId: target.id, body: body.trim() }), t.common.actions.unreachable);
      if (!r.ok) { setError(r.message ?? m.failed); return; }
      setBody("");
      setTarget(null);
      router.refresh();
    });
  }
  function remove(id: string) {
    start(async () => {
      const r = await settle(() => deleteWorkoutFeedback(id, clientId), t.common.actions.unreachable);
      if (!r.ok) setError(r.message ?? m.failed); else router.refresh();
    });
  }

  const box = (
    <div className="mt-2 grid gap-2">
      <textarea id="workout-feedback-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} autoFocus
        placeholder={target?.type === "set" ? m.setPlaceholder : m.sessionPlaceholder} className={`${FIELD} mt-0 py-2`} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={() => { setTarget(null); setBody(""); }} className="text-[12.5px] font-semibold text-ink-faint hover:text-ink">{m.cancel}</button>
        <button type="button" onClick={send} disabled={pending || !body.trim()} className={`${SMALL_BUTTON} h-9 px-4`}>{pending ? m.sending : m.send}</button>
      </div>
      {error ? <p role="alert" className="text-[12.5px] font-semibold text-risk">{error}</p> : null}
    </div>
  );

  return (
    <section data-testid="client-workouts-feedback">
      <h2 className="mb-1 font-display text-lg font-bold tracking-tight">{m.title}</h2>
      <p className="mb-3 text-[12.5px] text-ink-soft">{fill(m.lead, { name })}</p>
      {sessions.length === 0 ? (
        <Card plain><p className="text-[13px] text-ink-faint">{m.empty}</p></Card>
      ) : (
        <div className="space-y-2.5">
          {sessions.map((s) => {
            const isOpen = open === s.id;
            const comments = s.comments.length + s.sets.reduce((n, x) => n + x.comments.length, 0);
            return (
              <Card plain key={s.id}>
                <button type="button" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}
                  className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left">
                  <span className="font-semibold">{s.name ?? m.freeWorkout}</span>
                  <span className="text-[12px] tabular-nums text-ink-faint">
                    {new Date(s.started_at).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", { weekday: "short", day: "numeric", month: "short" })}
                    {" · "}{fill(m.sets, { n: s.sets.length })}{comments ? ` · ${fill(m.comments, { n: comments })}` : ""}
                  </span>
                </button>
                {isOpen ? (
                  <div className="mt-3 grid gap-3">
                    {byExercise(s.sets).map((g, gi) => (
                      <div key={`${g.exercise}-${gi}`}>
                        <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{g.exercise}</p>
                        <ul className="mt-1 divide-y divide-line/50">
                          {g.sets.map((x) => (
                            <li key={x.id} className="py-1.5">
                              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                                <span className="tabular-nums">{x.set_index}. {setLine(x, "kg", m)}</span>
                                <button type="button" onClick={() => { setTarget({ type: "set", id: x.id }); setBody(""); }}
                                  className="text-[12px] font-semibold text-accent-ink hover:underline">{m.commentSet}</button>
                              </div>
                              {x.notes ? <p className="text-[12px] italic text-ink-faint">“{x.notes}”</p> : null}
                              <Comments comments={x.comments} onDelete={remove} pending={pending} />
                              {target?.type === "set" && target.id === x.id ? box : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    <div className="border-t border-line pt-3">
                      <Comments comments={s.comments} onDelete={remove} pending={pending} />
                      {target?.type === "session" && target.id === s.id ? box : (
                        <button type="button" onClick={() => { setTarget({ type: "session", id: s.id }); setBody(""); }}
                          className={`${SMALL_BUTTON} mt-2 h-9 px-4`}>{m.commentSession}</button>
                      )}
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The client's side: one workout, set by set, with what the coach wrote on it. */
export function SessionWithFeedback({ session, unit }: { session: FeedbackSession; unit: Unit }) {
  const { t } = useI18n();
  const m = t.coachWidgets.workoutFeedback;
  return (
    <div className="grid gap-3">
      {session.comments.length > 0 ? (
        <Card plain>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.coachSays}</p>
          <Comments comments={session.comments} />
        </Card>
      ) : null}
      <Card plain>
        <div className="grid gap-3">
          {byExercise(session.sets).map((g, gi) => (
            <div key={`${g.exercise}-${gi}`}>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{g.exercise}</p>
              <ul className="mt-1 divide-y divide-line/50">
                {g.sets.map((x) => (
                  <li key={x.id} className="py-1.5 text-[13px]">
                    <span className="tabular-nums">{x.set_index}. {setLine(x, unit, m)}</span>
                    {x.notes ? <p className="text-[12px] italic text-ink-faint">“{x.notes}”</p> : null}
                    <Comments comments={x.comments} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
