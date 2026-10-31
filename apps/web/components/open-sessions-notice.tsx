"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finishOpenSession } from "@/app/client-actions-training";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { SMALL_BUTTON_INSET } from "@/lib/form-classes";
import { settle } from "@/lib/settle-action";
import { parseDay } from "@/lib/week";
import type { OpenSession } from "@/lib/types";

/**
 * Workouts with sets from an earlier day that nobody tapped "Finish" on
 * (getMyOpenSessions). Statistics count a session only once it is finished, so
 * until then those sets are nowhere — this says so and finishes one in a tap,
 * at its last set's time (finishOpenSession). Renders nothing when there are none.
 */
export function OpenSessionsNotice({ sessions }: { sessions: OpenSession[] }) {
  const { t, locale } = useI18n();
  const m = t.clientWidgets.openSession;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (sessions.length === 0 && !done) return null;

  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(parseDay(day));

  return (
    <div role="status" className="rounded-3xl bg-warn-soft px-5 py-[18px]">
      {sessions.length > 0 ? (
        <p className="text-[14.5px] font-semibold text-warn">
          {sessions.length === 1 ? m.title : fill(m.titleMany, { count: sessions.length })}
        </p>
      ) : null}
      <ul className="mt-2 space-y-3">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-[13px] text-ink-soft">
              {fill(m.body, { name: s.day_name ?? m.untitled, day: dayLabel(s.day), sets: s.set_count })}
            </p>
            <button
              type="button"
              className={SMALL_BUTTON_INSET}
              disabled={pending}
              onClick={() => {
                setError(null);
                setBusy(s.id);
                startTransition(async () => {
                  const r = await settle(() => finishOpenSession(s.id), t.common.actions.unreachable);
                  setBusy(null);
                  if (!r.ok) {
                    setError(r.message ?? t.clientWidgets.setLogger.couldNotFinish);
                    return;
                  }
                  setDone(fill(m.finished, { day: dayLabel(s.day) }));
                  router.refresh();
                });
              }}
            >
              {busy === s.id ? "…" : m.finish}
            </button>
          </li>
        ))}
      </ul>
      {done ? <p className="mt-2 text-[13px] text-ink-soft">{done}</p> : null}
      {error ? <p role="alert" className="mt-2 text-[13px] text-risk">{error}</p> : null}
    </div>
  );
}
