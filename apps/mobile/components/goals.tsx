import type { GoalCurrentV1, GoalsV1, GoalV1 } from "@healthapp/api/v1";
import {
  atLimit, cmToDisplay, displayToCm, displayToKg, GOAL_METRIC_SPEC, GOAL_METRICS, kgToDisplay,
  type GoalDirection, type GoalMetric,
} from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { PointsChart } from "@/components/charts";
import { Card, NavIcon, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { alpha, font, useTheme } from "@/lib/theme";

// Progress → Goals, the web's components/goals.tsx on a phone. It formats and
// collects input; each goal's progress arrives folded on the server
// (GET /api/v1/goals → packages/shared/goals), in canonical units, and only the
// reader's kg/lb, cm/in happen here. Every button goes through the web's own
// goal actions; final moves ask first, inline.

type Fmt = ReturnType<typeof useGoalFormat>;

function useGoalFormat(data: GoalsV1) {
  const { t, fill, locale, named } = useI18n();
  const g = t.clientApp.goals;
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const n0 = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" });
  const toDisplay = (metric: GoalMetric, v: number): number => {
    const unit = GOAL_METRIC_SPEC[metric].unit;
    return unit === "kg" ? kgToDisplay(v, data.weight_unit) : unit === "cm" ? cmToDisplay(v, data.length_unit) : v;
  };
  const fromDisplay = (metric: GoalMetric, v: number): number => {
    const unit = GOAL_METRIC_SPEC[metric].unit;
    return unit === "kg" ? displayToKg(v, data.weight_unit) : unit === "cm" ? displayToCm(v, data.length_unit) : v;
  };
  const unitLabel = (metric: GoalMetric): string => {
    const unit = GOAL_METRIC_SPEC[metric].unit;
    return unit === "kg" ? data.weight_unit : unit === "cm" ? data.length_unit : unit === "per_week" ? g.perWeek : unit === "pct" ? "%" : g.grams;
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
  return { t, g, fill, named, toDisplay, fromDisplay, unitLabel, value, signed, date };
}

function subtitle(goal: GoalV1, g: Fmt["g"]): string {
  const parts: string[] = [g.metric[goal.metric]];
  if (goal.exercise_name) parts.push(goal.exercise_name);
  if (goal.measure_key && goal.measure_key in g.measureKey) parts.push(g.measureKey[goal.measure_key as keyof typeof g.measureKey]);
  return parts.join(" · ");
}

function parseNumber(raw: string): number | null {
  const v = raw.trim().replace(",", ".");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const roundForInput = (v: number) => Math.round(v * 10) / 10;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A day some weeks after `from`, yyyy-mm-dd — the deadline shortcuts. */
function weeksAfter(from: string, weeks: number): string {
  const d = new Date(`${from}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/** One small pill button (the web's h-9 rounded-full actions). */
function PillButton({ label, onPress, tone = "plain", disabled, icon }: {
  label: string; onPress: () => void; tone?: "gold" | "plain" | "quiet" | "danger"; disabled?: boolean; icon?: string;
}) {
  const { color } = useTheme();
  const bg = tone === "gold" ? color.accent : tone === "danger" ? color.risk : tone === "plain" ? color.bg : "transparent";
  const ink = tone === "gold" ? color.accentFg : tone === "danger" ? color.bg : tone === "plain" ? color.inkSoft : color.inkFaint;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.pill, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }]}
    >
      {icon ? <NavIcon d={icon} size={16} color={ink} strokeWidth={2.4} /> : null}
      <Text style={{ fontFamily: tone === "gold" || tone === "danger" ? font.bold : font.semibold, fontSize: 12.5, color: ink }}>{label}</Text>
    </Pressable>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: on ? color.accent : color.bg, borderColor: on ? color.accent : color.line }]}
    >
      <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentFg : color.inkSoft }}>{label}</Text>
    </Pressable>
  );
}

function Input({ label, value, onChange, numeric = false, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void; numeric?: boolean; placeholder?: string; hint?: string;
}) {
  const { color } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 120 }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? "decimal-pad" : "default"}
        placeholder={placeholder}
        placeholderTextColor={color.inkFaint}
        style={[styles.input, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
      />
      {hint ? <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{hint}</Text> : null}
    </View>
  );
}

/** A deadline: none, a few weeks out, or a day typed as yyyy-mm-dd (a phone has no date box to borrow). */
function DeadlineField({ value, onChange, today, label }: { value: string; onChange: (v: string) => void; today: string; label: string }) {
  const { t } = useI18n();
  const g = t.clientApp.goals;
  const { color } = useTheme();
  return (
    <View>
      <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{label}</Text>
      <View style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Chip on={value === ""} label={g.noDeadline} onPress={() => onChange("")} />
        {[4, 8, 12].map((w) => {
          const day = weeksAfter(today, w);
          return <Chip key={w} on={value === day} label={`+${w} ${t.mobile.goals.weeks}`} onPress={() => onChange(day)} />;
        })}
      </View>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder="yyyy-mm-dd"
        placeholderTextColor={color.inkFaint}
        autoCapitalize="none"
        style={[styles.input, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
      />
    </View>
  );
}

/** A client's active goals as their coach sees them (ClientGoalsCard): read-only, in the coach's units. */
export function ClientGoals({ data, name }: { data: GoalsV1; name: string }) {
  const f = useGoalFormat(data);
  const { color } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.section(color.inkSoft)}>{f.fill(f.g.coachTitle, { name })}</Text>
      {data.active.length === 0 ? (
        <Card><T kind="faint">{f.g.coachNone}</T></Card>
      ) : data.active.map((goal) => <GoalCard key={goal.id} goal={goal} data={data} f={f} readOnly />)}
    </View>
  );
}

export function GoalsTab({ data }: { data: GoalsV1 }) {
  const f = useGoalFormat(data);
  const { g } = f;
  const { color } = useTheme();
  const full = atLimit(data.max_active, data.active.length);
  const [creating, setCreating] = useState(data.active.length === 0 && !full);

  return (
    <View style={{ gap: 20 }}>
      <Card style={{ gap: 0 }}>
        <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{g.intro}</Text>
        {data.main_goal ? (
          <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
            {`${g.mainGoal}: `}
            <Text style={{ fontFamily: font.semibold, color: color.ink }}>{f.named("goal", data.main_goal)}</Text>
          </Text>
        ) : null}
      </Card>

      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={styles.section(color.inkSoft)}>{g.active}</Text>
          {!creating && !full ? <PillButton tone="gold" icon="M12 5v14M5 12h14" label={g.newGoal} onPress={() => setCreating(true)} /> : null}
        </View>
        {full ? <T kind="faint">{f.fill(f.t.mobile.goals.goalsLimit, { limit: data.max_active ?? 0 })}</T> : null}
        {creating && !full ? <NewGoalForm data={data} f={f} onDone={() => setCreating(false)} canCancel={data.active.length > 0} /> : null}
        {data.active.length === 0 ? (
          creating ? null : (
            <View style={{ paddingVertical: 8 }}>
              <T kind="heading">{g.none}</T>
              <T kind="faint" style={{ marginTop: 4 }}>{g.noneHint}</T>
            </View>
          )
        ) : (
          data.active.map((goal) => <GoalCard key={goal.id} goal={goal} data={data} f={f} />)
        )}
      </View>

      {data.closed.length > 0 ? (
        <View style={{ gap: 12 }}>
          <Text style={styles.section(color.inkSoft)}>{g.finished}</Text>
          <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
            {data.closed.map((goal, i) => <ClosedRow key={goal.id} goal={goal} f={f} first={i === 0} />)}
          </Card>
        </View>
      ) : null}
    </View>
  );
}

function useGoalWrite() {
  const queryClient = useQueryClient();
  const { t: tt } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(work: () => Promise<{ ok: boolean; message?: string }>, after?: () => void): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const result = await work();
      if (!result.ok) {
        setError(result.message ?? tt.clientApp.goals.failed);
        return false;
      }
      after?.();
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      return true;
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? tt.mobile.errors.offline : tt.clientApp.goals.failed);
      return false;
    } finally {
      setPending(false);
    }
  }
  return { pending, error, run };
}

type Confirming = "achieved" | "abandoned" | "delete" | null;

function GoalCard({ goal, data, f, readOnly = false }: { goal: GoalV1; data: GoalsV1; f: Fmt; readOnly?: boolean }) {
  const { g } = f;
  const { color } = useTheme();
  const { pending, error, run } = useGoalWrite();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [editing, setEditing] = useState(false);
  const [chart, setChart] = useState(false);
  const p = goal.progress;

  const stateLabel = p.overdue ? g.overdue : g.state[p.state];
  const tone =
    p.state === "reached" ? { bg: color.accentSoft, ink: color.accentInk }
    : p.overdue || p.state === "off_track" ? { bg: color.riskSoft, ink: color.risk }
    : p.state === "in_progress" ? { bg: color.bg, ink: color.inkSoft }
    : { bg: color.warnSoft, ink: color.warn };
  const deadline =
    goal.target_date === null || p.daysLeft === null ? g.noDeadline
    : p.daysLeft > 1 ? f.fill(g.daysLeft, { count: p.daysLeft })
    : p.daysLeft === 1 ? g.dayLeft
    : p.daysLeft === 0 ? g.dueToday
    : f.fill(g.overdueBy, { count: -p.daysLeft });
  const confirmText =
    confirming === "achieved" ? f.fill(p.state === "reached" ? g.confirmAchieved : g.confirmAchievedEarly, { name: f.named("goal", goal.title) })
    : confirming === "abandoned" ? f.fill(g.confirmAbandon, { name: f.named("goal", goal.title) })
    : confirming === "delete" ? f.fill(g.confirmDelete, { name: f.named("goal", goal.title) })
    : "";

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{f.named("goal", goal.title)}</Text>
          <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{subtitle(goal, g)}</Text>
        </View>
        <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: tone.bg }}>
          <Text style={{ fontFamily: font.bold, fontSize: 11, color: tone.ink }}>{stateLabel}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", columnGap: 16 }}>
        <Text style={{ fontFamily: font.displayExtrabold, fontSize: 28, lineHeight: 30, color: color.ink }}>{p.current ? f.value(goal.metric, p.current.value) : "—"}</Text>
        <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>
          {`${g.target}: `}
          <Text style={{ fontFamily: font.semibold, color: color.ink }}>{f.value(goal.metric, goal.target_value)}</Text>
        </Text>
      </View>

      {p.pct !== null ? (
        <View accessibilityRole="progressbar" accessibilityLabel={g.progressLabel} accessibilityValue={{ min: 0, max: 100, now: p.pct }}>
          <View style={{ height: 10, borderRadius: 999, overflow: "hidden", backgroundColor: color.bg }}>
            <View style={{ height: "100%", borderRadius: 999, width: `${Math.max(p.pct, p.pct > 0 ? 3 : 0)}%`, backgroundColor: p.state === "off_track" ? color.risk : color.accent }} />
          </View>
          <Text style={{ marginTop: 4, textAlign: "right", fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>{f.fill(g.pctDone, { pct: p.pct })}</Text>
        </View>
      ) : null}

      <View style={{ gap: 2 }}>
        {p.missing ? <Line tone={color.warn}>{g.missing[p.missing]}</Line> : null}
        {p.state === "no_baseline" ? <Line tone={color.inkFaint}>{g.noBaselineHint}</Line> : null}
        {p.baseline !== null ? (
          <Line>
            {p.baselineFrom === "first_record"
              ? f.fill(g.startFromRecord, {
                  value: f.value(goal.metric, p.baseline),
                  date: f.date(goal.points.find((pt) => pt.day >= goal.start_date)?.day ?? goal.start_date),
                })
              : f.fill(g.startSet, { value: f.value(goal.metric, p.baseline) })}
            {p.change !== null ? ` · ${f.fill(g.change, { value: f.signed(goal.metric, p.change) })}` : ""}
          </Line>
        ) : null}
        {p.remaining !== null && p.state !== "reached" ? <Line>{f.fill(g.remaining, { value: f.value(goal.metric, p.remaining) })}</Line> : null}
        <Line tone={p.overdue ? color.risk : undefined} bold={p.overdue}>{`${deadline} · ${f.fill(g.since, { date: f.date(goal.start_date) })}`}</Line>
      </View>

      {p.state === "reached" ? (
        <View style={{ borderRadius: 16, backgroundColor: color.accentSoft, paddingHorizontal: 14, paddingVertical: 10 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{g.reachedHint}</Text>
        </View>
      ) : null}

      {goal.points.length > 0 ? (
        <View>
          <Text accessibilityRole="button" onPress={() => setChart((v) => !v)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>
            {`${chart ? "▾" : "▸"} ${g.chart}`}
          </Text>
          {chart ? (
            <View style={{ marginTop: 8 }}>
              <PointsChart flat title={g.chartTitle} unit={f.unitLabel(goal.metric)} points={goal.points.map((pt) => ({ day: pt.day, value: f.toDisplay(goal.metric, pt.value) }))} />
            </View>
          ) : null}
        </View>
      ) : null}

      {readOnly ? null : editing ? (
        <EditGoalForm goal={goal} data={data} f={f} onDone={() => setEditing(false)} />
      ) : confirming ? (
        <View style={{ gap: 10, borderRadius: 16, backgroundColor: color.bg, paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: confirming === "achieved" ? color.ink : color.risk }}>{confirmText}</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <PillButton
              tone={confirming === "achieved" ? "gold" : "danger"}
              disabled={pending}
              label={confirming === "achieved" ? g.markAchieved : confirming === "abandoned" ? g.abandon : g.delete}
              onPress={() =>
                void run(
                  () => (confirming === "delete" ? api.deleteGoal(goal.id) : api.closeGoal(goal.id, confirming)),
                  () => setConfirming(null),
                )
              }
            />
            <PillButton tone="quiet" label={g.cancel} onPress={() => setConfirming(null)} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <PillButton tone={p.state === "reached" ? "gold" : "plain"} disabled={pending} label={g.markAchieved} onPress={() => setConfirming("achieved")} />
          <PillButton tone="plain" disabled={pending} label={g.edit} onPress={() => setEditing(true)} />
          <PillButton tone="quiet" disabled={pending} label={g.abandon} onPress={() => setConfirming("abandoned")} />
          <PillButton tone="quiet" disabled={pending} label={g.delete} onPress={() => setConfirming("delete")} />
        </View>
      )}
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
    </Card>
  );
}

function Line({ children, tone, bold = false }: { children: ReactNode; tone?: string; bold?: boolean }) {
  const { color } = useTheme();
  return <Text style={{ fontFamily: bold ? font.semibold : font.regular, fontSize: 12.5, lineHeight: 18, color: tone ?? color.inkSoft }}>{children}</Text>;
}

/** Target, deadline and name of an active goal; the metric and start stay (a different question is a new goal). */
function EditGoalForm({ goal, data, f, onDone }: { goal: GoalV1; data: GoalsV1; f: Fmt; onDone: () => void }) {
  const { g } = f;
  const { color } = useTheme();
  const { pending, error, run } = useGoalWrite();
  const [title, setTitle] = useState(goal.title);
  const [target, setTarget] = useState(String(roundForInput(f.toDisplay(goal.metric, goal.target_value))));
  const [deadline, setDeadline] = useState(goal.target_date ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function save() {
    const typed = parseNumber(target);
    if (typed === null) return setLocalError(g.targetRequired);
    if (deadline && !DAY.test(deadline)) return setLocalError(g.deadline);
    setLocalError(null);
    void run(
      () => api.updateGoal({ goalId: goal.id, title, targetValue: f.fromDisplay(goal.metric, typed), targetDate: deadline || null }),
      onDone,
    );
  }

  return (
    <View style={{ gap: 12, borderRadius: 16, backgroundColor: alpha(color.bg, 0.6), padding: 14 }}>
      <Input label={g.name} value={title} onChange={setTitle} />
      <Input label={`${g.target} (${f.unitLabel(goal.metric)})`} value={target} onChange={setTarget} numeric />
      <DeadlineField label={g.deadline} value={deadline} onChange={setDeadline} today={data.today} />
      {localError || error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{localError ?? error}</Text> : null}
      <View style={{ flexDirection: "row", gap: 6 }}>
        <PillButton tone="gold" disabled={pending} label={g.save} onPress={save} />
        <PillButton tone="quiet" label={g.cancel} onPress={onDone} />
      </View>
    </View>
  );
}

function ClosedRow({ goal, f, first }: { goal: GoalV1; f: Fmt; first: boolean }) {
  const { g } = f;
  const { color } = useTheme();
  const { pending, error, run } = useGoalWrite();
  const [confirming, setConfirming] = useState(false);
  const closedOn = goal.closed_at ? f.date(goal.closed_at) : "";
  const achieved = goal.status === "achieved";
  return (
    <View style={[{ paddingHorizontal: 20, paddingVertical: 14 }, first ? null : { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) }]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{f.named("goal", goal.title)}</Text>
          <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
            {`${subtitle(goal, g)} · ${f.fill(g.targetWas, { value: f.value(goal.metric, goal.target_value) })}`}
          </Text>
        </View>
        <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: achieved ? color.accentSoft : color.bg }}>
          <Text style={{ fontFamily: font.bold, fontSize: 11, color: achieved ? color.accentInk : color.inkFaint }}>
            {achieved ? f.fill(g.achievedOn, { date: closedOn }) : f.fill(g.abandonedOn, { date: closedOn })}
          </Text>
        </View>
      </View>
      {confirming ? (
        <View style={{ marginTop: 8, gap: 6 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{f.fill(g.confirmDelete, { name: f.named("goal", goal.title) })}</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <PillButton tone="danger" disabled={pending} label={g.delete} onPress={() => void run(() => api.deleteGoal(goal.id), () => setConfirming(false))} />
            <PillButton tone="quiet" label={g.cancel} onPress={() => setConfirming(false)} />
          </View>
        </View>
      ) : (
        <Text accessibilityRole="button" onPress={() => setConfirming(true)} style={{ marginTop: 4, fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{g.delete}</Text>
      )}
      {error ? <Text style={{ marginTop: 4, fontFamily: font.semibold, fontSize: 12, color: color.risk }}>{error}</Text> : null}
    </View>
  );
}

function NewGoalForm({ data, f, onDone, canCancel }: { data: GoalsV1; f: Fmt; onDone: () => void; canCancel: boolean }) {
  const { g } = f;
  const { color } = useTheme();
  const { pending, error, run } = useGoalWrite();
  const measureKeys = Object.keys(data.current.circumference);
  const [metric, setMetric] = useState<GoalMetric>("body_weight");
  const [direction, setDirection] = useState<GoalDirection>("decrease");
  const [exerciseId, setExerciseId] = useState(data.exercises[0]?.id ?? "");
  const [measureKey, setMeasureKey] = useState(measureKeys[0] ?? "waist");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [startTouched, setStartTouched] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const current: GoalCurrentV1 =
    metric === "lift_weight"
      ? { value: data.exercises.find((e) => e.id === exerciseId)?.current ?? null, missing: "no_lift_sets" }
      : metric === "circumference"
        ? (data.current.circumference[measureKey] ?? { value: null, missing: "no_measurements" })
        : data.current[metric];
  const prefill = current.value !== null ? String(roundForInput(f.toDisplay(metric, current.value))) : "";
  // The start follows the chosen metric until the person types their own.
  const startShown = startTouched ? start : prefill;
  const directions = GOAL_METRIC_SPEC[metric].directions;
  const blocked =
    metric === "lift_weight" && data.exercises.length === 0 ? g.noLifts
    : metric === "kcal_on_target" && data.kcal_target === null ? g.noKcalTarget
    : null;

  function pick(next: GoalMetric) {
    setMetric(next);
    setStartTouched(false);
    setLocalError(null);
    const allowed = GOAL_METRIC_SPEC[next].directions;
    if (!allowed.includes(direction)) setDirection(allowed[0]!);
  }

  function submit() {
    const typedTarget = parseNumber(target);
    if (typedTarget === null) return setLocalError(g.targetRequired);
    if (deadline && !DAY.test(deadline)) return setLocalError(g.deadline);
    const typedStart = parseNumber(startShown);
    setLocalError(null);
    void run(
      () =>
        api.createGoal({
          metric,
          direction,
          targetValue: f.fromDisplay(metric, typedTarget),
          startValue: typedStart === null ? null : f.fromDisplay(metric, typedStart),
          targetDate: deadline || null,
          exerciseId: metric === "lift_weight" ? exerciseId || null : null,
          measureKey: metric === "circumference" ? measureKey : null,
          title: title.trim() || null,
        }),
      () => {
        setTarget("");
        setDeadline("");
        setTitle("");
        setStartTouched(false);
        onDone();
      },
    );
  }

  const label = (text: string) => <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{text}</Text>;

  return (
    <Card style={{ gap: 16 }}>
      <View>
        {label(g.whatToTrack)}
        <View style={styles.chips}>
          {GOAL_METRICS.map((m) => <Chip key={m} on={metric === m} label={g.metric[m]} onPress={() => pick(m)} />)}
        </View>
        <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.inkFaint }}>{g.metricHint[metric]}</Text>
      </View>

      {metric === "lift_weight" && data.exercises.length > 0 ? (
        <View>
          {label(g.exercise)}
          <View style={styles.chips}>
            {data.exercises.map((e) => <Chip key={e.id} on={exerciseId === e.id} label={e.name} onPress={() => { setExerciseId(e.id); setStartTouched(false); }} />)}
          </View>
        </View>
      ) : null}

      {metric === "circumference" ? (
        <View>
          {label(g.measurement)}
          <View style={styles.chips}>
            {measureKeys.map((k) => (
              <Chip
                key={k}
                on={measureKey === k}
                label={k in g.measureKey ? g.measureKey[k as keyof typeof g.measureKey] : k}
                onPress={() => { setMeasureKey(k); setStartTouched(false); }}
              />
            ))}
          </View>
        </View>
      ) : null}

      {directions.length > 1 ? (
        <View>
          {label(g.direction)}
          <View style={styles.chips}>
            {directions.map((d) => <Chip key={d} on={direction === d} label={d === "decrease" ? g.decrease : g.increase} onPress={() => setDirection(d)} />)}
          </View>
        </View>
      ) : null}

      {blocked ? (
        <View style={{ borderRadius: 16, backgroundColor: color.warnSoft, paddingHorizontal: 14, paddingVertical: 10 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.warn }}>{blocked}</Text>
        </View>
      ) : (
        <>
          <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>
            {current.value !== null ? f.fill(g.nowValue, { value: f.value(metric, current.value) }) : current.missing ? g.missing[current.missing] : ""}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <Input label={`${g.start} (${f.unitLabel(metric)})`} value={startShown} onChange={(v) => { setStart(v); setStartTouched(true); }} numeric hint={g.startHint} />
            <Input label={`${g.target} (${f.unitLabel(metric)})`} value={target} onChange={setTarget} numeric />
          </View>
          <DeadlineField label={g.deadline} value={deadline} onChange={setDeadline} today={data.today} />
          <Input label={g.name} value={title} onChange={setTitle} placeholder={g.namePlaceholder} />
        </>
      )}

      {localError || error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{localError ?? error}</Text> : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          disabled={pending || blocked !== null}
          onPress={submit}
          style={[styles.create, { backgroundColor: color.accent, opacity: pending || blocked !== null ? 0.5 : 1 }]}
        >
          {pending ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{g.create}</Text>}
        </Pressable>
        {canCancel ? <PillButton tone="quiet" label={g.cancel} onPress={onDone} /> : null}
      </View>
    </Card>
  );
}

const styles = {
  ...StyleSheet.create({
    pill: { height: 36, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 18, paddingHorizontal: 14 },
    chip: { minHeight: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, justifyContent: "center" },
    chips: { marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 6 },
    input: { marginTop: 6, height: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14 },
    create: { height: 44, minWidth: 120, borderRadius: 16, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  }),
  section: (ink: string) => ({ fontFamily: font.bold, fontSize: 12, letterSpacing: 0.72, textTransform: "uppercase" as const, color: ink }),
};
