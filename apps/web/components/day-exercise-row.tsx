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
}: {
  exercise: ExerciseSummary | null;
  name: string;
  prescription: string;
}) {
  const [open, setOpen] = useState(false);

  const body = (
    <>
      <p className="truncate text-[15px] font-semibold">{name}</p>
      <p className="shrink-0 text-[13px] tabular-nums text-ink-faint">{prescription}</p>
    </>
  );
  const cls = "flex w-full items-baseline gap-3.5 rounded-[20px] bg-surface px-4 py-3.5 text-left xl:px-[18px]";

  if (!exercise) return <div className={cls}>{body}</div>;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${cls} transition hover:text-accent-ink`}>
        {body}
      </button>
      {open ? <ExercisePreview exercise={exercise} onClose={() => setOpen(false)} pickLabel="" /> : null}
    </>
  );
}
