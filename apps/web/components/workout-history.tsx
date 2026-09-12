"use client";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { WorkoutHistorySession } from "@/lib/types";
import { Card } from "./ui";
import { TrainingLoadBadge } from "./training-load";

/**
 * Past sessions of one training day, newest first. The most recent one opens
 * expanded — "what did I do last time" is the question this screen answers —
 * and older ones unfold on tap.
 */
export function WorkoutHistory({ sessions }: { sessions: WorkoutHistorySession[] }) {
  const { t, locale } = useI18n();
  const d = t.clientApp.workoutDay;
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(sessions.slice(0, 1).map((s) => s.id)),
  );

  if (sessions.length === 0) {
    return <p className="text-sm text-ink-faint">{d.noHistory}</p>;
  }

  const fmt = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => {
        const open = openIds.has(session.id);
        return (
          <Card key={session.id} className="p-0">
            <button
              type="button"
              onClick={() => toggle(session.id)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-3 p-4 text-left"
            >
              <div className="min-w-0">
                <p className="font-semibold">{fmt.format(new Date(session.at))}</p>
                <p className="mt-0.5 text-xs tabular-nums text-ink-faint">
                  {session.sets} {d.sets} · {session.volume_kg.toLocaleString(locale === "ro" ? "ro-RO" : "en-GB")} kg {d.volume}
                  {session.prs > 0 ? (
                    <>
                      {" · "}
                      <span className="font-semibold text-accent-ink">{session.prs} {d.prs}</span>
                    </>
                  ) : null}
                </p>
              </div>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <TrainingLoadBadge load={session.load} showLabel={false} />
                <span className="text-xs font-semibold text-ink-faint">{open ? d.hideSets : d.showSets}</span>
              </span>
            </button>

            {open ? (
              <div className="space-y-3 border-t border-line p-4">
                {session.exercises.map((exercise) => (
                  <div key={exercise.name}>
                    <p className="text-sm font-semibold">{exercise.name}</p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {exercise.sets.map((s) => (
                        <li
                          key={s.id}
                          title={s.notes ?? undefined}
                          className={`rounded-md px-2 py-1 text-xs tabular-nums ${
                            s.is_pr ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft"
                          }`}
                        >
                          {s.weight_kg} kg × {s.reps}
                          {s.rir !== null ? ` · ${d.rir} ${s.rir}` : ""}
                          {s.rpe !== null ? ` · ${s.rpe}/10 ${d.intensity}` : ""}
                        </li>
                      ))}
                    </ul>
                    {exercise.sets.some((s) => s.notes) ? (
                      <ul className="mt-1.5 space-y-0.5">
                        {exercise.sets
                          .filter((s) => s.notes)
                          .map((s) => (
                            <li key={`${s.id}-note`} className="text-xs italic text-ink-faint">
                              #{s.set_index}: {s.notes}
                            </li>
                          ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
