"use client";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { WorkoutHistorySession } from "@/lib/types";
import { shareCardFromHistory, type ShareCardProfile } from "@/lib/share-card";
import { Card } from "./ui";
import { TrainingLoadBadge } from "./training-load";
import { EditSet } from "./edit-set";
import { ShareWorkoutButton } from "./share-workout";

/**
 * Past sessions of one training day, newest first. The most recent one opens
 * expanded — "what did I do last time" is the question this screen answers —
 * and older ones unfold on tap. Each open session can be shared as an external
 * card, built from that session's rows (already on screen), never the latest.
 */
export function WorkoutHistory({ sessions, share }: {
  sessions: WorkoutHistorySession[];
  /** What the card needs beyond the row: the day's name and the author. Omit to hide Share. */
  share?: { dayName: string; profile: ShareCardProfile | null };
}) {
  const { t, locale } = useI18n();
  const d = t.clientApp.workoutDay;
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(sessions.slice(0, 1).map((s) => s.id)),
  );
  // Past sets can be corrected too — the same form as the logger. Edits are
  // kept here until the refresh brings the server's rows back.
  const [editing, setEditing] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<WorkoutHistorySession["exercises"][number]["sets"][number]>>>({});

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
                {share && session.sets > 0 ? (
                  <ShareWorkoutButton
                    card={shareCardFromHistory(session, share.dayName, share.profile)}
                    className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold hover:border-accent disabled:opacity-50"
                  />
                ) : null}
                {session.exercises.map((exercise) => (
                  <div key={exercise.name}>
                    <p className="text-sm font-semibold">{exercise.name}</p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {exercise.sets.map((raw) => {
                        const s = { ...raw, ...overrides[raw.id] };
                        return (
                        <li key={s.id}>
                          <button
                            type="button"
                            title={s.notes ?? t.clientWidgets.setLogger.editSet}
                            aria-label={`${t.clientWidgets.setLogger.editSet}: ${s.weight_kg} kg × ${s.reps}`}
                            onClick={() => setEditing(editing === s.id ? null : s.id)}
                            className={`min-h-8 rounded-md px-2 py-1 text-xs tabular-nums ${
                              s.is_pr ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"
                            } ${editing === s.id ? "ring-2 ring-accent-ink" : ""}`}
                          >
                            {s.weight_kg} kg × {s.reps}
                            {s.rir !== null ? ` · ${d.rir} ${s.rir}` : ""}
                            {s.rpe !== null ? ` · ${s.rpe}/10 ${d.intensity}` : ""}
                          </button>
                        </li>
                        );
                      })}
                    </ul>
                    {editing && exercise.sets.some((x) => x.id === editing) ? (
                      <EditSet
                        set={{ ...exercise.sets.find((x) => x.id === editing)!, ...overrides[editing] }}
                        asRir={exercise.sets.some((x) => x.rir !== null)}
                        onDone={(updated) => {
                          setEditing(null);
                          if (updated) setOverrides((prev) => ({ ...prev, [updated.id]: updated }));
                        }}
                      />
                    ) : null}
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
