"use client";
import Link from "next/link";
import { formatSetDuration, kgToDisplay, type PreviousWorkout, type Progression, type SetAdvice } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { timeAgo } from "@/lib/format";
import { usePlan } from "@/lib/plan-client";
import { PremiumSoon } from "./upgrade";
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
              {s.duration_seconds
                ? `${s.weight_kg > 0 ? `${kgToDisplay(s.weight_kg, u.weightUnit)} ${u.weightUnit} · ` : ""}${formatSetDuration(s.duration_seconds)}`
                : `${kgToDisplay(s.weight_kg, u.weightUnit)} ${u.weightUnit} × ${s.reps}`}
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

/**
 * The Premium "try this next" line under the previous sets: a load and reps
 * worked out from the same set last time (nextSetAdvice), with the reason in
 * plain words and a button that puts it in the boxes. The boxes themselves
 * keep opening on last time, so ignoring this changes nothing. On a plan
 * without it, one quiet line says where it lives.
 */
export function NextSetAdvice({ advice, onUse }: { advice: SetAdvice | null; onUse: (a: SetAdvice) => void }) {
  const { t } = useI18n();
  const u = useUnits();
  const { e: plan, upgrade } = usePlan();
  const m = t.clientWidgets.setLogger;
  if (!advice) return null;
  if (!plan.progressionAdvice) {
    return (
      <Link href={upgrade.href} className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-ink-faint hover:text-ink-soft">
        <NavIcon d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" className="h-3 w-3" />
        {fill(m.adviceLocked, { plan: upgrade.label })}
      </Link>
    );
  }
  const set = advice.weight_kg > 0
    ? `${kgToDisplay(advice.weight_kg, u.weightUnit)} ${u.weightUnit} × ${advice.reps}`
    : `× ${advice.reps}`;
  const why = {
    add_weight: m.adviceAddWeight,
    add_rep: m.adviceAddRep,
    hold_missed: m.adviceHoldMissed,
    hold_hard: m.adviceHoldHard,
  }[advice.reason];
  return (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-accent-soft/40 py-1.5 pl-2.5 pr-1.5">
      <p className="min-w-0 text-[11.5px] leading-snug">
        <span className="font-semibold tabular-nums text-accent-ink">{fill(m.adviceTry, { set })}</span>
        <span className="text-ink-soft"> · {why}</span>
        <PremiumSoon feature="progressionAdvice" className="ml-1.5 align-[1px]" />
      </p>
      <button type="button" onClick={() => onUse(advice)}
        className="shrink-0 rounded-lg bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-ink-soft hover:text-ink">
        {m.adviceUse}
      </button>
    </div>
  );
}
