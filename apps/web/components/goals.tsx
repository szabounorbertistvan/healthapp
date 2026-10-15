"use client";
import { settle } from "@/lib/settle-action";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  displayToCm,
  displayToKg,
  GOAL_METRIC_SPEC,
  GOAL_METRICS,
  type GoalDirection,
  type GoalMetric,
} from "@healthapp/shared";
import { closeGoal, createGoal, deleteGoal, updateGoal } from "@/app/goal-actions";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { FIELD, LABEL, HINT } from "@/lib/form-classes";
import type { GoalCurrent, GoalDashboard, GoalView } from "@/lib/goals-data";
import { PointsChart } from "./exercise-analytics";
import { Card, Chip, EmptyState } from "./ui";
import { NavIcon } from "./client-nav";

/**
 * Progress → Goals. It formats and collects input; it never computes: each
 * goal's progress arrives folded on the server (packages/shared/goals over the
 * person's own rows), in canonical units, and only the last step — the
 * reader's kg/lb, cm/in — happens here.
 *
 * Every button does what it says through a server action and refreshes the
 * server render; destructive or final moves (achieved, abandon, delete) ask
 * first, inline, the way the program builder's delete does.
 */
export function GoalsPanel({ dashboard }: { dashboard: GoalDashboard }) {
  const { t } = useI18n();
  const g = t.clientApp.goals;
  const [creating, setCreating] = useState(dashboard.active.length === 0);

  return (
    <div className="space-y-5">
      <Card plain className="sm:p-5">
        <p className="text-[13.5px] leading-relaxed text-ink-soft">{g.intro}</p>
        {dashboard.mainGoal ? (
          <p className="mt-2 text-[12.5px] text-ink-faint">
            {g.mainGoal}: <span className="font-semibold text-ink">{dashboard.mainGoal}</span>
          </p>
        ) : null}
      </Card>

      <section aria-labelledby="goals-active">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="goals-active" className="text-xs font-bold uppercase tracking-[0.06em] text-ink-soft">{g.active}</h2>
          {!creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[12.5px] font-bold text-accent-fg hover:opacity-90"
            >
              <NavIcon d="M12 5v14M5 12h14" className="h-4 w-4 [stroke-width:2.4]" />
              {g.newGoal}
            </button>
          ) : null}
        </div>

        {creating ? (
          <div className="mb-4">
            <NewGoalForm dashboard={dashboard} onDone={() => setCreating(false)} canCancel={dashboard.active.length > 0} />
          </div>
        ) : null}

        {dashboard.active.length === 0 ? (
          creating ? null : <EmptyState plain title={g.none} hint={g.noneHint} />
        ) : (
          <div className="grid gap-4 @3xl:grid-cols-2">
            {dashboard.active.map((goal) => (
              <GoalCard key={goal.id} goal={goal} today={dashboard.today} />
            ))}
          </div>
        )}
      </section>

      {dashboard.closed.length > 0 ? (
        <section aria-labelledby="goals-finished">
          <h2 id="goals-finished" className="mb-3 text-xs font-bold uppercase tracking-[0.06em] text-ink-soft">{g.finished}</h2>
          <Card plain className="p-0">
            <ul className="divide-y divide-line/60">
              {dashboard.closed.map((goal) => (
                <ClosedGoalRow key={goal.id} goal={goal} />
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

// ---------- formatting ----------

function useGoalFormat() {
  const { t, locale } = useI18n();
  const u = useUnits();
  const g = t.clientApp.goals;
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const n0 = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" });

  /** Canonical → the number shown in an input or a chart (kg/cm converted, others as they are). */
  const toDisplay = (metric: GoalMetric, v: number): number => {
    const unit = GOAL_METRIC_SPEC[metric].unit;
    return unit === "kg" ? u.weightValue(v) : unit === "cm" ? u.lengthValue(v) : v;
  };
  /** The number typed → canonical, unrounded (rounding belongs to display). */
  const fromDisplay = (metric: GoalMetric, v: number): number => {
    const unit = GOAL_METRIC_SPEC[metric].unit;
    return unit === "kg" ? displayToKg(v, u.weightUnit) : unit === "cm" ? displayToCm(v, u.lengthUnit) : v;
  };
  const unitLabel = (metric: GoalMetric): string => {
    const unit = GOAL_METRIC_SPEC[metric].unit;
    return unit === "kg" ? u.weightUnit : unit === "cm" ? u.lengthUnit : unit === "per_week" ? g.perWeek : unit === "pct" ? "%" : g.grams;
  };
  const value = (metric: GoalMetric, v: number): string => {
    const unit = GOAL_METRIC_SPEC[metric].unit;
    if (unit === "kg" || unit === "cm") return `${n1.format(toDisplay(metric, v))} ${unitLabel(metric)}`;
    if (unit === "pct") return `${n0.format(v)}%`;
    if (unit === "per_week") return `${n1.format(v)} ${g.perWeek}`;
    return `${n0.format(v)} ${g.grams}`;
  };
  const signed = (metric: GoalMetric, v: number): string => {
    const text = value(metric, Math.abs(v));
    return v > 0 ? `+${text}` : v < 0 ? `−${text}` : text;
  };
  const date = (day: string): string => {
    const [y = 1970, m = 1, d = 1] = day.slice(0, 10).split("-").map(Number);
    return df.format(new Date(y, m - 1, d));
  };
  return { t, g, toDisplay, fromDisplay, unitLabel, value, signed, date };
}

function goalSubtitle(goal: GoalView, g: ReturnType<typeof useGoalFormat>["g"]): string {
  const parts: string[] = [g.metric[goal.metric]];
  if (goal.exercise_name) parts.push(goal.exercise_name);
  if (goal.measure_key && goal.measure_key in g.measureKey) parts.push(g.measureKey[goal.measure_key as keyof typeof g.measureKey]);
  return parts.join(" · ");
}

// ---------- one active goal ----------

type Confirming = "achieved" | "abandoned" | "delete" | null;

/**
 * A client's active goals as their coach sees them: the same cards, folded by
 * the same server code over the client's rows (getClientGoalDashboard), with
 * every button left out — goals are the client's to set, change and close.
 */
export function ClientGoalsCard({ dashboard, name }: { dashboard: GoalDashboard; name: string }) {
  const { t } = useI18n();
  const g = t.clientApp.goals;
  return (
    <section aria-labelledby="client-goals" data-testid="client-goals" className="@container">
      <h2 id="client-goals" className="mb-3 font-display text-lg font-bold tracking-tight">
        {fill(g.coachTitle, { name })}
      </h2>
      {dashboard.active.length === 0 ? (
        <Card plain>
          <p className="text-[13px] text-ink-faint">{g.coachNone}</p>
        </Card>
      ) : (
        <div className="grid gap-4 @3xl:grid-cols-2">
          {dashboard.active.map((goal) => (
            <GoalCard key={goal.id} goal={goal} today={dashboard.today} readOnly />
          ))}
        </div>
      )}
    </section>
  );
}

function GoalCard({ goal, today, readOnly = false }: { goal: GoalView; today: string; readOnly?: boolean }) {
  const f = useGoalFormat();
  const { g, t } = f;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const p = goal.progress;

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await settle(action, t.common.actions.unreachable);
      if (!result.ok) {
        setError(result.message ?? g.failed);
        return;
      }
      setConfirming(null);
      setEditing(false);
      setNote(result.message ?? null);
      router.refresh();
    });
  }

  const stateLabel = p.overdue ? g.overdue : g.state[p.state];
  const tone =
    p.state === "reached" ? "bg-accent-soft text-accent-ink"
    : p.overdue || p.state === "off_track" ? "bg-risk-soft text-risk"
    : p.state === "in_progress" ? "bg-bg text-ink-soft"
    : "bg-warn-soft text-warn";

  const deadline =
    goal.target_date === null ? g.noDeadline
    : p.daysLeft === null ? g.noDeadline
    : p.daysLeft > 1 ? fill(g.daysLeft, { count: p.daysLeft })
    : p.daysLeft === 1 ? g.dayLeft
    : p.daysLeft === 0 ? g.dueToday
    : fill(g.overdueBy, { count: -p.daysLeft });

  const chartPoints = goal.points.map((pt) => ({ day: pt.day, value: f.toDisplay(goal.metric, pt.value) }));

  const confirmText =
    confirming === "achieved" ? fill(p.state === "reached" ? g.confirmAchieved : g.confirmAchievedEarly, { name: goal.title })
    : confirming === "abandoned" ? fill(g.confirmAbandon, { name: goal.title })
    : confirming === "delete" ? fill(g.confirmDelete, { name: goal.title })
    : "";

  return (
    <Card plain className="flex flex-col gap-3 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-bold leading-tight tracking-tight">{goal.title}</h3>
          <p className="mt-0.5 truncate text-[12px] text-ink-faint">{goalSubtitle(goal, g)}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${tone}`}>{stateLabel}</span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <p className="font-display text-[28px] font-extrabold tabular-nums leading-none">
          {p.current ? f.value(goal.metric, p.current.value) : "—"}
        </p>
        <p className="text-[12.5px] text-ink-soft">
          {g.target}: <span className="font-semibold text-ink">{f.value(goal.metric, goal.target_value)}</span>
        </p>
      </div>

      {/* The bar is drawn only for a real percentage; a missing one says why instead. */}
      {p.pct !== null ? (
        <div>
          <div
            role="progressbar"
            aria-label={g.progressLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={p.pct}
            className="h-2.5 w-full overflow-hidden rounded-full bg-bg"
          >
            <div
              className={`h-full rounded-full ${p.state === "off_track" ? "bg-risk" : "bg-accent"}`}
              style={{ width: `${Math.max(p.pct, p.pct > 0 ? 3 : 0)}%` }}
            />
          </div>
          <p className="mt-1 text-right text-[11.5px] font-semibold tabular-nums text-ink-soft">{fill(g.pctDone, { pct: p.pct })}</p>
        </div>
      ) : null}

      <ul className="space-y-0.5 text-[12.5px] text-ink-soft">
        {p.missing ? <li className="text-warn">{g.missing[p.missing]}</li> : null}
        {p.state === "no_baseline" ? <li className="text-ink-faint">{g.noBaselineHint}</li> : null}
        {p.baseline !== null ? (
          <li>
            {p.baselineFrom === "first_record"
              ? fill(g.startFromRecord, {
                  value: f.value(goal.metric, p.baseline),
                  date: f.date(goal.points.find((pt) => pt.day >= goal.start_date)?.day ?? goal.start_date),
                })
              : fill(g.startSet, { value: f.value(goal.metric, p.baseline) })}
            {p.change !== null ? ` · ${fill(g.change, { value: f.signed(goal.metric, p.change) })}` : ""}
          </li>
        ) : null}
        {p.remaining !== null && p.state !== "reached" ? <li>{fill(g.remaining, { value: f.value(goal.metric, p.remaining) })}</li> : null}
        <li className={p.overdue ? "font-semibold text-risk" : ""}>
          {deadline} · {fill(g.since, { date: f.date(goal.start_date) })}
        </li>
      </ul>

      {p.state === "reached" && !readOnly ? (
        <p className="rounded-2xl bg-accent-soft px-3.5 py-2.5 text-[12.5px] font-semibold text-accent-ink">{g.reachedHint}</p>
      ) : null}

      {chartPoints.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-ink-faint hover:text-ink">{g.chart}</summary>
          <div className="mt-2 rounded-2xl bg-bg">
            <PointsChart title={g.chartTitle} points={chartPoints} unit={f.unitLabel(goal.metric)} />
          </div>
        </details>
      ) : null}

      {readOnly ? null : editing ? (
        <EditGoalForm goal={goal} today={today} pending={pending} onCancel={() => setEditing(false)} onSave={run} />
      ) : confirming ? (
        <div className="space-y-2.5 rounded-2xl bg-bg px-4 py-3" role="alertdialog" aria-label={confirmText}>
          <p className={`text-[13px] font-semibold ${confirming === "achieved" ? "text-ink" : "text-risk"}`}>{confirmText}</p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={pending}
              autoFocus
              onClick={() =>
                run(() => (confirming === "delete" ? deleteGoal(goal.id) : closeGoal(goal.id, confirming)))
              }
              className={`inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-bold disabled:opacity-50 ${
                confirming === "achieved" ? "bg-accent text-accent-fg" : "bg-risk text-bg"
              }`}
            >
              {confirming === "achieved" ? g.markAchieved : confirming === "abandoned" ? g.abandon : g.delete}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
            >
              {g.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming("achieved")}
            className={`inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-bold disabled:opacity-50 ${
              p.state === "reached" ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"
            }`}
          >
            {g.markAchieved}
          </button>
          <button type="button" disabled={pending} onClick={() => setEditing(true)}
            className="inline-flex h-9 items-center rounded-full bg-bg px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50">
            {g.edit}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirming("abandoned")}
            className="inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-semibold text-ink-faint hover:text-risk disabled:opacity-50">
            {g.abandon}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirming("delete")}
            className="inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-semibold text-ink-faint hover:text-risk disabled:opacity-50">
            {g.delete}
          </button>
        </div>
      )}

      <div role="status" aria-live="polite">
        {note ? <p className="text-[12.5px] font-semibold text-accent-ink">{note}</p> : null}
        {error ? <p className="text-[12.5px] font-semibold text-risk">{error}</p> : null}
      </div>
    </Card>
  );
}

/** Target, deadline and name of an active goal. The metric and start stay: a different question is a new goal. */
function EditGoalForm({
  goal, today, pending, onCancel, onSave,
}: {
  goal: GoalView;
  today: string;
  pending: boolean;
  onCancel: () => void;
  onSave: (action: () => Promise<{ ok: boolean; message?: string }>) => void;
}) {
  const f = useGoalFormat();
  const { g } = f;
  const [title, setTitle] = useState(goal.title);
  const [target, setTarget] = useState(String(roundForInput(f.toDisplay(goal.metric, goal.target_value))));
  const [deadline, setDeadline] = useState(goal.target_date ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function save() {
    const typed = parseNumber(target);
    if (typed === null) {
      setLocalError(g.targetRequired);
      return;
    }
    setLocalError(null);
    onSave(() => updateGoal({
      goalId: goal.id,
      title,
      targetValue: f.fromDisplay(goal.metric, typed),
      targetDate: deadline || null,
    }));
  }

  return (
    <div className="space-y-3 rounded-2xl bg-bg p-3.5">
      <label className={LABEL}>
        {g.name}
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className={FIELD.replace("bg-bg", "bg-surface")} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          {g.target} ({f.unitLabel(goal.metric)})
          <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={localError !== null}
            className={FIELD.replace("bg-bg", "bg-surface")} />
        </label>
        <label className={LABEL}>
          {g.deadline}
          <input type="date" value={deadline} min={goal.target_date && goal.target_date < today ? undefined : today}
            onChange={(e) => setDeadline(e.target.value)} className={FIELD.replace("bg-bg", "bg-surface")} />
        </label>
      </div>
      {localError ? <p className="text-[12.5px] font-semibold text-risk">{localError}</p> : null}
      <div className="flex items-center gap-1.5">
        <button type="button" disabled={pending} onClick={save}
          className="inline-flex h-9 items-center rounded-full bg-accent px-3.5 text-[12.5px] font-bold text-accent-fg disabled:opacity-50">
          {g.save}
        </button>
        <button type="button" onClick={onCancel}
          className="inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink">
          {g.cancel}
        </button>
      </div>
    </div>
  );
}

// ---------- history ----------

function ClosedGoalRow({ goal }: { goal: GoalView }) {
  const f = useGoalFormat();
  const { g, t } = f;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closedOn = goal.closed_at ? f.date(goal.closed_at) : "";

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold">{goal.title}</p>
          <p className="mt-0.5 text-[12px] text-ink-faint">
            {goalSubtitle(goal, g)} · {fill(g.targetWas, { value: f.value(goal.metric, goal.target_value) })}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
          goal.status === "achieved" ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-faint"
        }`}>
          {goal.status === "achieved" ? fill(g.achievedOn, { date: closedOn }) : fill(g.abandonedOn, { date: closedOn })}
        </span>
      </div>
      {confirming ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <p className="w-full text-[12.5px] font-semibold text-risk">{fill(g.confirmDelete, { name: goal.title })}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await settle(() => deleteGoal(goal.id), t.common.actions.unreachable);
                if (!result.ok) { setError(result.message ?? g.failed); return; }
                setConfirming(false);
                router.refresh();
              })
            }
            className="inline-flex h-8 items-center rounded-full bg-risk px-3 text-[12px] font-bold text-bg disabled:opacity-50"
          >
            {g.delete}
          </button>
          <button type="button" onClick={() => setConfirming(false)}
            className="inline-flex h-8 items-center rounded-full px-3 text-[12px] font-semibold text-ink-soft hover:text-ink">
            {g.cancel}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}
          className="mt-1 text-[12px] font-semibold text-ink-faint hover:text-risk">
          {g.delete}
        </button>
      )}
      {error ? <p className="mt-1 text-[12px] font-semibold text-risk">{error}</p> : null}
    </li>
  );
}

// ---------- a new goal ----------

function parseNumber(raw: string): number | null {
  const v = raw.trim().replace(",", ".");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundForInput(v: number): number {
  return Math.round(v * 10) / 10;
}

function NewGoalForm({
  dashboard, onDone, canCancel,
}: {
  dashboard: GoalDashboard;
  onDone: () => void;
  canCancel: boolean;
}) {
  const f = useGoalFormat();
  const { g, t } = f;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const measureKeys = Object.keys(dashboard.current.circumference);
  const [metric, setMetric] = useState<GoalMetric>("body_weight");
  const [direction, setDirection] = useState<GoalDirection>("decrease");
  const [exerciseId, setExerciseId] = useState(dashboard.exercises[0]?.id ?? "");
  const [measureKey, setMeasureKey] = useState(measureKeys[0] ?? "waist");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [title, setTitle] = useState("");

  const current: GoalCurrent =
    metric === "lift_weight"
      ? { value: dashboard.exercises.find((e) => e.id === exerciseId)?.current ?? null, missing: "no_lift_sets" }
      : metric === "circumference"
        ? (dashboard.current.circumference[measureKey] ?? { value: null, missing: "no_measurements" })
        : dashboard.current[metric];
  const prefill = current.value !== null ? String(roundForInput(f.toDisplay(metric, current.value))) : "";
  const [start, setStart] = useState(prefill);
  const [startTouched, setStartTouched] = useState(false);
  // The start follows the chosen metric until the person types their own.
  const startShown = startTouched ? start : prefill;

  const directions = GOAL_METRIC_SPEC[metric].directions;
  const blocked =
    metric === "lift_weight" && dashboard.exercises.length === 0 ? g.noLifts
    : metric === "kcal_on_target" && dashboard.kcalTarget === null ? g.noKcalTarget
    : null;

  function pick(next: GoalMetric) {
    setMetric(next);
    setStartTouched(false);
    setError(null);
    const allowed = GOAL_METRIC_SPEC[next].directions;
    if (!allowed.includes(direction)) setDirection(allowed[0]!);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const typedTarget = parseNumber(target);
    if (typedTarget === null) {
      setError(g.targetRequired);
      return;
    }
    const typedStart = parseNumber(startShown);
    setError(null);
    startTransition(async () => {
      const result = await settle(() => createGoal({
        metric,
        direction,
        targetValue: f.fromDisplay(metric, typedTarget),
        startValue: typedStart === null ? null : f.fromDisplay(metric, typedStart),
        targetDate: deadline || null,
        exerciseId: metric === "lift_weight" ? exerciseId || null : null,
        measureKey: metric === "circumference" ? measureKey : null,
        title: title.trim() || null,
      }), t.common.actions.unreachable);
      if (!result.ok) {
        setError(result.message ?? g.failed);
        return;
      }
      setTarget("");
      setDeadline("");
      setTitle("");
      setStartTouched(false);
      onDone();
      router.refresh();
    });
  }

  return (
    <Card plain className="sm:p-5">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <fieldset>
          <legend className="text-[13px] font-semibold text-ink-soft">{g.whatToTrack}</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {GOAL_METRICS.map((m) => (
              <Chip key={m} on={metric === m} onToggle={() => pick(m)}>{g.metric[m]}</Chip>
            ))}
          </div>
          <p className={HINT}>{g.metricHint[metric]}</p>
        </fieldset>

        {metric === "lift_weight" && dashboard.exercises.length > 0 ? (
          <label className={LABEL}>
            {g.exercise}
            <select value={exerciseId} onChange={(e) => { setExerciseId(e.target.value); setStartTouched(false); }} className={FIELD}>
              {dashboard.exercises.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
        ) : null}

        {metric === "circumference" ? (
          <label className={LABEL}>
            {g.measurement}
            <select value={measureKey} onChange={(e) => { setMeasureKey(e.target.value); setStartTouched(false); }} className={FIELD}>
              {measureKeys.map((k) => (
                <option key={k} value={k}>{k in g.measureKey ? g.measureKey[k as keyof typeof g.measureKey] : k}</option>
              ))}
            </select>
          </label>
        ) : null}

        {directions.length > 1 ? (
          <fieldset>
            <legend className="text-[13px] font-semibold text-ink-soft">{g.direction}</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {directions.map((d) => (
                <Chip key={d} on={direction === d} onToggle={() => setDirection(d)}>{d === "decrease" ? g.decrease : g.increase}</Chip>
              ))}
            </div>
          </fieldset>
        ) : null}

        {blocked ? (
          <p className="rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[12.5px] font-semibold text-warn">{blocked}</p>
        ) : (
          <>
            <p className="text-[12.5px] text-ink-soft">
              {current.value !== null
                ? fill(g.nowValue, { value: f.value(metric, current.value) })
                : current.missing ? g.missing[current.missing] : null}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={LABEL}>
                {g.start} ({f.unitLabel(metric)})
                <input inputMode="decimal" value={startShown}
                  onChange={(e) => { setStart(e.target.value); setStartTouched(true); }} className={FIELD} />
                <span className={HINT}>{g.startHint}</span>
              </label>
              <label className={LABEL}>
                {g.target} ({f.unitLabel(metric)})
                <input inputMode="decimal" required value={target} onChange={(e) => setTarget(e.target.value)}
                  aria-invalid={error === g.targetRequired} className={FIELD} />
              </label>
              <label className={LABEL}>
                {g.deadline}
                <input type="date" min={dashboard.today} value={deadline} onChange={(e) => setDeadline(e.target.value)} className={FIELD} />
              </label>
            </div>
            <label className={LABEL}>
              {g.name}
              <input value={title} maxLength={80} placeholder={g.namePlaceholder} onChange={(e) => setTitle(e.target.value)} className={FIELD} />
            </label>
          </>
        )}

        <div role="status" aria-live="polite">
          {error ? <p className="text-[12.5px] font-semibold text-risk">{error}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending || blocked !== null}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50">
            {pending ? g.creating : g.create}
          </button>
          {canCancel ? (
            <button type="button" onClick={onDone}
              className="inline-flex h-11 items-center rounded-2xl px-4 text-[13px] font-semibold text-ink-soft hover:text-ink">
              {g.cancel}
            </button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
