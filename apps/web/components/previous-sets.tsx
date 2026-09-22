"use client";
import Link from "next/link";
import { kgToDisplay, type PreviousWorkout, type Progression } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { timeAgo } from "@/lib/format";
import { NavIcon } from "./client-nav";

/**
 * What this person did on this lift the last time they finished a workout with
 * it in — sitting directly above the boxes they are about to type into, so the
 * target is known without leaving the screen (PRODUCT_SPEC B1).
 *
 * Deliberately small: on a 375px phone this strip must cost a few lines, not
 * half the viewport. One row per set, the set number in a gutter, the load and
 * reps in tabular figures so three rows read as a column of numbers.
 */
export function PreviousSets({
  previous,
  exerciseId,
}: {
  previous: PreviousWorkout | null;
  /** exercises.id — makes the header a link to the full history. Null hides it. */
  exerciseId?: string | null;
}) {
  const { t, locale } = useI18n();
  const u = useUnits();
  const m = t.clientWidgets.setLogger;

  if (!previous || previous.sets.length === 0) {
    return (
      <p className="mt-2.5 text-[11.5px] text-ink-faint">
        {m.previousNone}
      </p>
    );
  }

  return (
    <div className="mt-2.5 rounded-xl border-l-[3px] border-line bg-bg/60 py-1.5 pl-2.5 pr-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          {m.previous} · {timeAgo(previous.at, locale)}
        </p>
        {exerciseId ? (
          <Link
            href={`/exercises/${exerciseId}`}
            className="inline-flex shrink-0 items-center gap-1 text-[10.5px] font-semibold text-ink-faint hover:text-accent-ink"
          >
            {m.openExercise}
            <NavIcon d="m9 6 6 6-6 6" className="h-3 w-3" />
          </Link>
        ) : null}
      </div>
      <ul className="mt-1 space-y-0.5">
        {previous.sets.map((s) => (
          <li key={s.set_index} className="flex items-baseline gap-2 text-[11.5px] tabular-nums text-ink-soft">
            <span className="w-3 shrink-0 text-right text-[10px] text-ink-faint">{s.set_index}</span>
            <span className="font-semibold text-ink">
              {kgToDisplay(s.weight_kg, u.weightUnit)} {u.weightUnit} × {s.reps}
            </span>
            {s.rir !== null ? <span className="text-ink-faint">· {m.rir} {s.rir}</span> : null}
            {s.rir === null && s.rpe !== null ? <span className="text-ink-faint">· {s.rpe}/10</span> : null}
            {s.is_pr ? <span className="font-semibold text-accent-ink">· {m.pr}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One factual line after a set lands: heavier, lighter, more reps, fewer, or
 * the same. Never a judgement — a lighter day is a training decision, not a
 * failure — so "down" is muted rather than red.
 */
export function ProgressionNote({ progression }: { progression: Progression | null }) {
  const { t } = useI18n();
  const u = useUnits();
  const m = t.clientWidgets.setLogger;
  if (!progression) return null;

  const kg = Math.abs(progression.weight_delta_kg);
  const reps = Math.abs(progression.reps_delta);
  const text =
    progression.kind === "weight_up" ? fill(m.vsPreviousUp, { value: kgToDisplay(kg, u.weightUnit) })
    : progression.kind === "weight_down" ? fill(m.vsPreviousDown, { value: kgToDisplay(kg, u.weightUnit) })
    : progression.kind === "reps_up" ? fill(m.vsPreviousRepsUp, { value: reps })
    : progression.kind === "reps_down" ? fill(m.vsPreviousRepsDown, { value: reps })
    : m.vsPreviousSame;
  const arrow =
    progression.kind === "weight_up" || progression.kind === "reps_up" ? "↑"
    : progression.kind === "weight_down" || progression.kind === "reps_down" ? "↓"
    : "=";
  const tone =
    progression.kind === "weight_up" || progression.kind === "reps_up" ? "text-accent-ink" : "text-ink-faint";

  return (
    <p className={`mt-2 text-[11.5px] font-semibold tabular-nums ${tone}`} role="status">
      {arrow} {text}
    </p>
  );
}
