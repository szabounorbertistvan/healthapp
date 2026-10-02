"use client";
import { useState } from "react";
import type { ExerciseSummary } from "@healthapp/shared";
import { ExercisePreview } from "./exercise-picker";

/**
 * One exercise of a training day, as a button: a tap opens the same popup the
 * exercise library shows (photos, demo video, how-to, "My history"). The page
 * loads the day's exercises with itself, so it opens instantly. A row with
 * nothing to show (no exercise found) stays a plain line.
 */
export function DayExerciseRow({
  exercise,
  name,
  prescription,
  note = null,
  noteLabel = "",
}: {
  exercise: ExerciseSummary | null;
  name: string;
  prescription: string;
  /** The coach's own cue for this exercise, shown under the row. */
  note?: string | null;
  noteLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  const body = (
    <>
      <p className="truncate text-[15px] font-semibold">{name}</p>
      <p className="shrink-0 text-[13px] tabular-nums text-ink-faint">{prescription}</p>
    </>
  );
  const cls = "flex w-full items-baseline gap-3.5 rounded-[20px] bg-surface px-4 py-3.5 text-left xl:px-[18px]";
  // Outside the button: a cue is read, not tapped, and may run several lines.
  const cue = note ? (
    <div className="mx-2 -mt-1 rounded-b-2xl border-l-[3px] border-accent bg-accent-soft/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-accent-ink">{noteLabel}</p>
      <p className="mt-0.5 whitespace-pre-line text-[13px] text-ink">{note}</p>
    </div>
  ) : null;

  if (!exercise) return <div><div className={cls}>{body}</div>{cue}</div>;

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)} className={`${cls} transition hover:text-accent-ink`}>
        {body}
      </button>
      {cue}
      {open ? <ExercisePreview exercise={exercise} onClose={() => setOpen(false)} pickLabel="" /> : null}
    </div>
  );
}
