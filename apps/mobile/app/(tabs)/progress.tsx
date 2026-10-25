import type { ProgressOverviewV1 } from "@healthapp/api/v1";
import {
  cmToDisplay, displayToCm, displayToKg, EXERCISE_RANGES, FITNESS_SCORE_MIN_WORKOUTS, kgToDisplay,
  type BodyMetric, type PeriodBucket, type PeriodChange, type ProgressInsight, type ProgressRange,
} from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PointsChart } from "@/components/charts";
import { GoalsTab } from "@/components/goals";
import { Card, NavIcon, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { parseDecimal } from "@/lib/logger-model";
import { useOfflineQuery } from "@/lib/offline-query";
import { alpha, font, useTheme } from "@/lib/theme";
import { parseDay } from "@/lib/week";

// Progress — the web's /progress on a phone (app/(client)/progress/page.tsx and
// components/advanced-progress.tsx): one range compared with the one before,
// the four headline figures, the insights, then Body / Strength / Consistency
// / Goals. Every figure arrives folded on the server (GET /api/v1/progress/
// overview runs the page's own reads through packages/shared); this screen
// only formats. Goals have their own read (components/goals.tsx); a single
// lift's charts, two-date comparison and photos open on the web.

const web = (path: string) => () => void Linking.openURL(`${config.webUrl}${path}`);
type Tab = "body" | "strength" | "consistency" | "goals";

const ICON = {
  scale: "M12 4a2 2 0 1 0 0 4 2 2 0 1 0 0-4M12 8v3M5 11h14l-2.5 9h-9zM8 14h8",
  sessions: "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8",
  volume: "M4 19h16M7 19V9M12 19V5M17 19v-6",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  ruler: "M3 9h18v6H3zM7 9v3M11 9v4M15 9v3M19 9v4",
  report: "M12 3v12M7 10l5 5 5-5M5 21h14",
} as const;

/** The web's useFormat(): numbers in the reader's locale and units, rounded at the last step. */
function useFormat(data: ProgressOverviewV1 | undefined) {
  const { t, locale, fill } = useI18n();
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const n0 = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" });
  const wu = data?.weight_unit ?? "kg";
  const lu = data?.length_unit ?? "cm";
  return {
    t, fill, locale, tag,
    a: t.clientApp.advancedProgress,
    wu, lu,
    count: (v: number) => n0.format(v),
    one: (v: number) => n1.format(v),
    pct: (v: number) => n1.format(Math.abs(v)),
    kg: (kg: number) => `${n1.format(kgToDisplay(kg, wu))} ${wu}`,
    bigKg: (kg: number) => `${n0.format(kgToDisplay(kg, wu))} ${wu}`,
    cm: (cm: number) => `${n1.format(cmToDisplay(cm, lu))} ${lu}`,
    date: (day: string) => df.format(parseDay(day)),
  };
}
type Fmt = ReturnType<typeof useFormat>;

export default function Progress() {
  const { t } = useI18n();
  const { color } = useTheme();
  const [range, setRange] = useState<ProgressRange>(30);
  const [tab, setTab] = useState<Tab>("body");
  const key = range === null ? "all" : String(range);
  const query = useOfflineQuery(`progress:${key}`, ["progress", key], () => api.progressOverview(key));
  const data = query.data?.data;
  const f = useFormat(data);
  const a = f.a;

  const rangeLabel = (r: ProgressRange) => (r === null ? a.rangeAll : r === 7 ? a.range7 : r === 30 ? a.range30 : r === 90 ? a.range90 : a.range365);
  const tabLabel: Record<Tab, string> = { body: a.tabBody, strength: a.tabStrength, consistency: a.tabConsistency, goals: a.tabGoals };
  const note = range === null ? a.allTimeNoCompare : data?.has_previous ? f.fill(a.vsPrevious, { days: range }) : a.noPrevious;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <T kind="title">{t.common.nav.progress}</T>
            <Pressable accessibilityRole="link" onPress={web("/reports")} style={[styles.pill, { backgroundColor: color.surface }]}>
              <NavIcon d={ICON.report} size={16} color={color.inkSoft} />
              <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{t.clientApp.reports.link}</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
            {EXERCISE_RANGES.map((r) => {
              const on = r === range;
              return (
                <Pressable
                  key={String(r)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => setRange(r)}
                  style={[styles.pill, { backgroundColor: on ? color.accent : color.surface }]}
                >
                  <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentFg : color.inkSoft }}>{rangeLabel(r)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View>
            <Text style={styles.small(color.inkFaint)}>{note}</Text>
            {data?.truncated ? <Text style={[styles.small(color.inkFaint), { marginTop: 4 }]}>{a.truncated}</Text> : null}
          </View>
        </View>
        {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}

        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <View style={styles.grid2}>
              <Stat icon={ICON.scale} label={t.clientApp.progress.currentWeight}
                value={data.stats.current_weight_kg !== null ? String(kgToDisplay(data.stats.current_weight_kg, f.wu)) : "—"}
                unit={data.stats.current_weight_kg !== null ? f.wu : undefined} />
              <Stat icon={ICON.sessions} label={t.clientApp.progress.sessionsLogged} value={String(data.stats.sessions)} />
              <Stat icon={ICON.volume} label={t.clientApp.progress.totalVolume} value={f.count(kgToDisplay(data.stats.total_volume_kg, f.wu))} unit={f.wu} />
              <Stat icon={ICON.trophy} label={t.clientApp.progress.personalRecords} value={String(data.stats.prs)} accent />
            </View>

            <Insights insights={data.insights} names={data.names} f={f} />

            <View style={[styles.tabs, { backgroundColor: color.surface }]}>
              {(["body", "strength", "consistency", "goals"] as const).map((x) => {
                const on = x === tab;
                return (
                  <Pressable
                    key={x}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    onPress={() => setTab(x)}
                    style={[styles.tab, on ? { backgroundColor: color.bg } : null]}
                  >
                    <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 12, color: on ? color.ink : color.inkSoft }}>{tabLabel[x]}</Text>
                  </Pressable>
                );
              })}
            </View>

            {tab === "body" ? <BodyTab data={data} f={f} /> : null}
            {tab === "strength" ? <StrengthTab data={data} f={f} /> : null}
            {tab === "consistency" ? <ConsistencyTab data={data} f={f} /> : null}
            {tab === "goals" ? <GoalsSection /> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Goals read on their own (GET /api/v1/goals): they do not follow the range. */
function GoalsSection() {
  const { t } = useI18n();
  const { color } = useTheme();
  const query = useOfflineQuery("goals", ["goals"], api.goals);
  const data = query.data?.data;
  if (data) return <GoalsTab data={data} />;
  return query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 24 }} />;
}

// ---------- shared pieces ----------

/** One headline figure on its own surface tile: icon, label, number, unit. */
function Stat({ icon, label, value, unit, accent = false }: { icon: string; label: string; value: string; unit?: string; accent?: boolean }) {
  const { color } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: color.surface }]}>
      <NavIcon d={icon} size={40} color={color.accentInk} />
      <Text numberOfLines={1} style={styles.label(color.inkFaint, 11)}>{label}</Text>
      <Text style={{ fontFamily: font.displayExtrabold, fontSize: 32, lineHeight: 34, color: accent ? color.accentInk : color.ink }}>
        {value}
        {unit ? <Text style={{ fontFamily: font.medium, fontSize: 14, color: color.inkFaint }}>{` ${unit}`}</Text> : null}
      </Text>
    </View>
  );
}

function Eyebrow({ children, aside }: { children: ReactNode; aside?: string }) {
  const { color } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
      <Text style={styles.label(color.inkFaint, 11)}>{children}</Text>
      {aside ? <Text style={styles.small(color.inkFaint, 11)}>{aside}</Text> : null}
    </View>
  );
}

function SectionLabel({ icon, children }: { icon: string; children: ReactNode }) {
  const { color } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <NavIcon d={icon} size={18} color={color.accentInk} />
      <Text style={styles.label(color.inkFaint, 11)}>{children}</Text>
    </View>
  );
}

/** A figure and where it came from (advanced-progress.tsx Figure); the tone is neutral on purpose. */
function Figure({ label, value, change, format, hint, f }: {
  label: string; value: string; change?: PeriodChange | null; format?: (v: number) => string; hint?: string; f: Fmt;
}) {
  const { color } = useTheme();
  const sign = change ? (change.delta > 0 ? "+" : change.delta < 0 ? "−" : "±") : "";
  return (
    <View style={[styles.figure, { backgroundColor: color.surface }]}>
      <Text style={styles.label(color.inkFaint, 10.5)}>{label}</Text>
      <Text style={{ marginTop: 4, fontFamily: font.displayExtrabold, fontSize: 22, lineHeight: 26, color: color.ink }}>{value}</Text>
      {change && format ? (
        <Text style={[styles.small(color.inkFaint, 11.5), { marginTop: 4 }]}>
          {`${f.fill(f.a.previousValue, { value: format(change.previous) })} · `}
          <Text style={{ fontFamily: font.semibold, color: change.delta > 0 ? color.accentInk : color.inkSoft }}>
            {`${sign}${format(Math.abs(change.delta))}${change.pct !== null && change.delta !== 0 ? ` (${change.delta > 0 ? "+" : "−"}${f.pct(change.pct)}%)` : ""}`}
          </Text>
        </Text>
      ) : null}
      {hint ? <Text style={[styles.small(color.inkFaint, 10.5), { marginTop: 4 }]}>{hint}</Text> : null}
    </View>
  );
}

function signed(change: PeriodChange, format: (v: number) => string, pct: (v: number) => string): string {
  const sign = change.delta > 0 ? "+" : change.delta < 0 ? "−" : "±";
  const p = change.pct !== null && change.delta !== 0 ? ` (${sign}${pct(change.pct)}%)` : "";
  return `${sign}${format(Math.abs(change.delta))}${p}`;
}

/** The sentences (InsightsCard), worded from the folded insight exactly as the web words them. */
function Insights({ insights, names, f }: { insights: ProgressInsight[]; names: Record<string, string>; f: Fmt }) {
  const { color } = useTheme();
  const a = f.a;
  const sentence = (i: ProgressInsight): string => {
    switch (i.key) {
      case "one_rm_change":
        return f.fill(i.pct > 0 ? a.insightOneRmUp : a.insightOneRmDown, { exercise: names[i.exercise_id] ?? "—", pct: f.pct(i.pct) });
      case "volume_change":
        return f.fill(i.pct > 0 ? a.insightVolumeUp : a.insightVolumeDown, { pct: f.pct(i.pct) });
      case "load_change":
        return f.fill(i.pct > 0 ? a.insightLoadUp : a.insightLoadDown, { pct: f.pct(i.pct) });
      case "active_days":
        return f.fill(a.insightActiveDays, { current: i.current, previous: i.previous });
      case "week_workouts":
        return f.fill(a.insightWeekWorkouts, { current: i.current, previous: i.previous });
      case "weight_change":
        return f.fill(i.basis === "within" ? a.insightWeightWithin : a.insightWeight, {
          delta: `${i.delta_kg > 0 ? "+" : "−"}${f.one(Math.abs(kgToDisplay(i.delta_kg, f.wu)))}`,
          unit: f.wu,
        });
      case "prs":
        return i.count === 1 ? a.insightPr : f.fill(a.insightPrs, { count: i.count });
    }
  };
  return (
    <Card style={{ gap: 0 }}>
      <Eyebrow>{a.insights}</Eyebrow>
      {insights.length === 0 ? (
        <Text style={[styles.small(color.inkFaint, 13), { marginTop: 10 }]}>{a.insightsEmpty}</Text>
      ) : (
        <View style={{ marginTop: 10, gap: 8 }}>
          {insights.map((i) => (
            <View key={i.key + ("exercise_id" in i ? i.exercise_id : "")} style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ marginTop: 7, width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent }} />
              <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.ink }}>{sentence(i)}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/** Bars per week or month (advanced-progress.tsx Bars); an empty bucket keeps a hairline. */
function Bars({ title, unit, items, value, format, f }: {
  title: string; unit: "week" | "month"; items: PeriodBucket[]; value: (b: PeriodBucket) => number; format: (v: number) => string; f: Fmt;
}) {
  const { color } = useTheme();
  const peak = Math.max(0, ...items.map(value));
  const first = items[0];
  const last = items[items.length - 1];
  return (
    <Card style={{ gap: 0 }}>
      <Eyebrow aside={unit === "week" ? f.a.perWeek : f.a.perMonth}>{title}</Eyebrow>
      {peak === 0 || !first || !last ? (
        <Text style={[styles.small(color.inkFaint, 13), { marginTop: 12 }]}>{f.a.noWorkouts}</Text>
      ) : (
        <>
          <View style={{ marginTop: 14, height: 112, flexDirection: "row", alignItems: "flex-end", gap: 3 }}>
            {items.map((b) => {
              const v = value(b);
              return (
                <View key={b.start} style={{ flex: 1, height: "100%", justifyContent: "flex-end" }}>
                  <View style={{
                    width: "100%", borderTopLeftRadius: 4, borderTopRightRadius: 4,
                    backgroundColor: b.workouts === 0 ? color.line : color.accent,
                    height: b.workouts === 0 ? 2 : `${Math.max((v / peak) * 100, 4)}%`,
                  }} />
                </View>
              );
            })}
          </View>
          <View style={{ marginTop: 8, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <Text style={styles.small(color.inkFaint, 11)}>{f.date(first.start)}</Text>
            <Text style={{ fontFamily: font.bold, fontSize: 11, color: color.accentInk }}>{format(peak)}</Text>
            <Text style={styles.small(color.inkFaint, 11)}>{f.date(last.start)}</Text>
          </View>
        </>
      )}
    </Card>
  );
}

// ---------- body ----------

function BodyCard({ title, metric, kind, data, f }: { title: string; metric: BodyMetric; kind: "weight" | "length"; data: ProgressOverviewV1; f: Fmt }) {
  const { color } = useTheme();
  const format = kind === "weight" ? f.kg : f.cm;
  const toUnit = (v: number) => (kind === "weight" ? kgToDisplay(v, f.wu) : cmToDisplay(v, f.lu));
  return (
    <View style={{ gap: 10 }}>
      <Figure
        f={f}
        label={title}
        value={metric.latest ? format(metric.latest.value) : "—"}
        change={metric.change}
        format={format}
        hint={metric.latest ? f.fill(f.a.latestWeighIn, { date: f.date(metric.latest.day) }) : f.a.noWeighIns}
      />
      {metric.within && metric.series[0] ? (
        <Text style={[styles.small(color.inkSoft), { paddingHorizontal: 4 }]}>
          {`${f.fill(f.a.sinceStart, { date: f.date(metric.series[0].day) })} `}
          <Text style={{ fontFamily: font.semibold, color: color.ink }}>{signed(metric.within, format, f.pct)}</Text>
        </Text>
      ) : null}
      {data.charts ? (
        <PointsChart title={title} unit={kind === "weight" ? f.wu : f.lu} points={metric.series.map((p) => ({ day: p.day, value: toUnit(p.value) }))} />
      ) : null}
    </View>
  );
}

function BodyTab({ data, f }: { data: ProgressOverviewV1; f: Fmt }) {
  const { color } = useTheme();
  const t = f.t;
  const circ = f.a.circ as Record<string, string>;
  const keys = Object.keys(data.body.circumferences);
  return (
    <View style={{ gap: 16 }}>
      <BodyCard f={f} data={data} title={f.a.bodyWeight} metric={data.body.weight} kind="weight" />
      {keys.length === 0 ? (
        <Card style={{ gap: 0 }}>
          <Eyebrow>{f.a.circumferences}</Eyebrow>
          <Text style={[styles.small(color.inkFaint, 13), { marginTop: 10 }]}>{f.a.noCircumferences}</Text>
        </Card>
      ) : (
        keys.map((key) => <BodyCard key={key} f={f} data={data} title={circ[key] ?? key} metric={data.body.circumferences[key]!} kind="length" />)
      )}

      <MeasurementForm data={data} />

      <Pressable accessibilityRole="link" onPress={web("/progress?tab=body")}>
        <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>
            {`${f.a.compareDates} · ${t.clientApp.progress.photos}`}
          </Text>
          <NavIcon d="m9 6 6 6-6 6" size={16} color={color.inkFaint} />
        </Card>
      </Pressable>

      {data.measurements.length === 0 ? (
        <View style={{ paddingVertical: 8 }}>
          <T kind="heading">{t.clientApp.progress.noMeasurementsTitle}</T>
          <T kind="faint" style={{ marginTop: 4 }}>{t.clientApp.progress.noMeasurementsHint}</T>
        </View>
      ) : (
        <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 }}>
            <SectionLabel icon={ICON.ruler}>{t.clientApp.progress.measurements}</SectionLabel>
          </View>
          <View style={[styles.tableRow, { borderBottomWidth: 1, borderBottomColor: alpha(color.line, 0.6) }]}>
            <Text style={[styles.label(color.inkFaint, 11), { flex: 1 }]}>{t.clientApp.progress.date}</Text>
            <Text style={[styles.label(color.inkFaint, 11), styles.cell]}>{`${t.clientApp.progress.weight} (${f.wu})`}</Text>
            <Text style={[styles.label(color.inkFaint, 11), styles.cell]}>{`${t.clientApp.progress.waist} (${f.lu})`}</Text>
          </View>
          {data.measurements.map((m, i) => (
            <View key={m.id} style={[styles.tableRow, i > 0 ? { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) } : null]}>
              <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft }}>{m.taken_on}</Text>
              <Text style={[styles.cell, { fontFamily: font.semibold, fontSize: 13.5, color: color.ink }]}>{m.weight_kg !== null ? String(kgToDisplay(m.weight_kg, f.wu)) : "—"}</Text>
              <Text style={[styles.cell, { fontFamily: font.semibold, fontSize: 13.5, color: color.ink }]}>{m.waist_cm !== null ? String(cmToDisplay(m.waist_cm, f.lu)) : "—"}</Text>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

/** Add a measurement (measurement-form.tsx): weight and waist in the reader's units. */
function MeasurementForm({ data }: { data: ProgressOverviewV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const m = t.clientWidgets.measurementForm;
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    const w = weight.trim() ? parseDecimal(weight) : null;
    const c = waist.trim() ? parseDecimal(waist) : null;
    if ((w !== null && !(w > 0)) || (c !== null && !(c > 0)) || (w === null && c === null)) {
      return setNote({ ok: false, text: m.couldNotSave });
    }
    setBusy(true);
    setNote(null);
    try {
      const result = await api.addMeasurement({
        weightKg: w === null ? null : displayToKg(w, data.weight_unit),
        waistCm: c === null ? null : displayToCm(c, data.length_unit),
      });
      if (!result.ok) setNote({ ok: false, text: result.message ?? m.couldNotSave });
      else {
        setNote({ ok: true, text: t.mobile.progress.saved });
        setWeight("");
        setWaist("");
        await queryClient.invalidateQueries({ queryKey: ["progress"] });
      }
    } catch (error) {
      setNote({ ok: false, text: error instanceof ApiFailure && error.kind === "offline" ? t.mobile.food.needsSignal : m.couldNotSave });
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, value: string, set: (v: string) => void) => (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={styles.label(color.inkFaint, 10)}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={set}
        keyboardType="decimal-pad"
        accessibilityLabel={label}
        style={[styles.input, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]}
      />
    </View>
  );

  return (
    <Card style={{ gap: 0 }}>
      <Text style={styles.label(color.inkFaint, 11)}>{m.title}</Text>
      <View style={{ marginTop: 12, flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
        {field(fill(m.weightKg, { unit: data.weight_unit }), weight, setWeight)}
        {field(fill(m.waistCm, { unit: data.length_unit }), waist, setWaist)}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void save()}
          style={[styles.goldButton, { backgroundColor: color.accent, opacity: busy ? 0.4 : 1 }]}
        >
          {busy ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{t.common.actions.save}</Text>}
        </Pressable>
      </View>
      {note ? <Text style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 13, color: note.ok ? color.accentInk : color.risk }}>{note.text}</Text> : null}
    </Card>
  );
}

// ---------- strength ----------

function StrengthTab({ data, f }: { data: ProgressOverviewV1; f: Fmt }) {
  const { color } = useTheme();
  const [about, setAbout] = useState(false);
  const a = f.a;
  const t = f.t;
  const c = data.training.changes;
  const cur = data.training.current;
  const fs = data.fitness;
  return (
    <View style={{ gap: 16 }}>
      <View style={styles.grid2}>
        <Figure f={f} label={a.volume} value={f.bigKg(cur.volume_kg)} change={c?.volume_kg} format={f.bigKg} />
        <Figure f={f} label={a.trainingLoad} value={f.count(cur.total_load)} change={c?.total_load} format={f.count} hint={a.trainingLoadHint} />
        <Figure f={f} label={a.avgLoad} value={cur.avg_load === null ? "—" : f.one(cur.avg_load)} change={c?.avg_load} format={f.one} />
        {fs ? (
          <Figure
            f={f}
            label={a.fitnessScore}
            value={fs.score === null ? "—" : String(fs.score)}
            change={fs.trend ? { ...fs.trend, pct: null } : null}
            format={f.count}
            hint={fs.score === null ? f.fill(a.fitnessBuilding, { count: FITNESS_SCORE_MIN_WORKOUTS }) : a.fitnessScoreHint}
          />
        ) : null}
      </View>

      <Pressable accessibilityRole="button" accessibilityState={{ expanded: about }} onPress={() => setAbout((v) => !v)} style={[styles.details, { backgroundColor: color.surface }]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{a.aboutScores}</Text>
          <Text style={{ color: color.inkFaint, transform: [{ rotate: about ? "180deg" : "0deg" }] }}>⌄</Text>
        </View>
        {about ? (
          <View style={{ marginTop: 8, gap: 6 }}>
            <Text style={styles.prose(color.inkSoft)}>{a.aboutLoad}</Text>
            <Text style={styles.prose(color.inkSoft)}>{f.fill(a.aboutFitness, { count: FITNESS_SCORE_MIN_WORKOUTS })}</Text>
            <Text style={styles.prose(color.inkSoft)}>{a.aboutRecovery}</Text>
            <Text onPress={web("/fitness-score")} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{`${a.fitnessBreakdown} →`}</Text>
          </View>
        ) : null}
      </Pressable>

      <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4 }}>
          <Eyebrow>{a.mainLifts}</Eyebrow>
          <Text style={[styles.small(color.inkFaint, 12.5), { marginTop: 6 }]}>{a.mainLiftsHint}</Text>
        </View>
        {data.highlights.length === 0 ? (
          <Text style={[styles.small(color.inkFaint, 13), { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 18 }]}>{a.noMainLifts}</Text>
        ) : (
          data.highlights.slice(0, 6).map((h, i) => (
            <View key={h.exercise_id} style={[styles.listRow, i > 0 ? { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) } : null]}>
              <Text numberOfLines={1} onPress={() => router.push({ pathname: "/exercise/[id]", params: { id: h.exercise_id } })} style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: color.ink }}>
                {data.names[h.exercise_id] ?? "—"}
              </Text>
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                {`${f.kg(h.change.previous)} → `}
                <Text style={{ fontFamily: font.bold, color: color.ink }}>{f.kg(h.change.current)}</Text>
                {h.change.pct !== null ? (
                  <Text style={{ fontFamily: font.semibold, color: h.change.delta > 0 ? color.accentInk : color.inkSoft }}>
                    {`  ${h.change.delta > 0 ? "+" : h.change.delta < 0 ? "−" : "±"}${f.pct(h.change.pct)}%`}
                  </Text>
                ) : null}
              </Text>
            </View>
          ))
        )}
      </Card>

      {data.charts ? (
        <>
          <Bars f={f} title={a.volume} unit={data.buckets.unit} items={data.buckets.items} value={(b) => b.volume_kg} format={f.bigKg} />
          <Bars f={f} title={a.trainingLoad} unit={data.buckets.unit} items={data.buckets.items} value={(b) => b.load} format={f.count} />
        </>
      ) : null}

      <Pressable accessibilityRole="link" onPress={web("/progress?tab=strength")}>
        <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{a.exercise}</Text>
          <NavIcon d="m9 6 6 6-6 6" size={16} color={color.inkFaint} />
        </Card>
      </Pressable>

      <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4 }}>
          <SectionLabel icon={ICON.trophy}>{t.clientApp.progress.personalRecords}</SectionLabel>
        </View>
        {data.prs.length === 0 ? (
          <Text style={[styles.small(color.inkFaint, 13), { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 18 }]}>{t.clientApp.progress.noPrs}</Text>
        ) : (
          data.prs.map((pr, i) => (
            <View key={pr.exercise} style={[styles.listRow, { paddingVertical: 14 }, i > 0 ? { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) } : null]}>
              <Text
                numberOfLines={1}
                onPress={pr.exercise_id ? () => router.push({ pathname: "/exercise/[id]", params: { id: pr.exercise_id! } }) : undefined}
                style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: color.ink }}
              >
                {pr.exercise}
              </Text>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontFamily: font.displayExtrabold, fontSize: 17, color: color.ink }}>
                  {kgToDisplay(pr.best_kg, f.wu)}
                  <Text style={{ fontFamily: font.medium, fontSize: 12, color: color.inkFaint }}>{` ${f.wu}`}</Text>
                </Text>
                <Text style={[styles.small(color.inkFaint, 11.5), { marginTop: 2 }]}>{`${t.clientApp.progress.est1Rm} · ${pr.ago}`}</Text>
              </View>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

// ---------- consistency ----------

function ConsistencyTab({ data, f }: { data: ProgressOverviewV1; f: Fmt }) {
  const { color } = useTheme();
  const a = f.a;
  const c = data.training.changes;
  const cur = data.training.current;
  const planned = data.planned_per_week;
  const adHoc = cur.workouts - cur.from_program;
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 0 }}>
        <Eyebrow>{a.thisWeek}</Eyebrow>
        <Text style={{ marginTop: 6, fontFamily: font.displayExtrabold, fontSize: 22, lineHeight: 26, color: color.ink }}>
          {planned === null
            ? f.fill(data.this_week === 1 ? a.thisWeekOne : a.thisWeekMany, { count: data.this_week })
            : f.fill(a.thisWeekOfPlan, { done: data.this_week, planned })}
        </Text>
        <Text style={[styles.small(color.inkFaint), { marginTop: 4 }]}>
          {planned === null ? a.noProgramTarget : f.fill(a.planTargetHint, { planned })}
        </Text>
      </Card>

      <View style={styles.grid2}>
        <Figure f={f} label={a.workouts} value={f.count(cur.workouts)} change={c?.workouts} format={f.count} />
        <Figure f={f} label={a.workoutsPerWeek} value={f.one(cur.workouts_per_week)} change={c?.workouts_per_week} format={f.one} />
        <Figure f={f} label={a.activeWeeks} value={f.fill(a.weeksOf, { active: cur.active_weeks, weeks: cur.weeks })} change={c?.active_weeks} format={f.count} />
        <Figure f={f} label={a.activeDays} value={f.count(cur.active_days)} change={c?.active_days} format={f.count} />
        <Figure
          f={f}
          label={a.medianDuration}
          value={cur.median_minutes === null ? "—" : `${f.count(cur.median_minutes)} min`}
          change={c?.median_minutes}
          format={(v) => `${f.count(v)} min`}
          hint={cur.workouts > 0 && cur.timed < cur.workouts ? f.fill(a.timedOf, { timed: cur.timed, workouts: cur.workouts }) : undefined}
        />
        <Figure f={f} label={a.fromProgram} value={f.count(cur.from_program)} hint={cur.workouts > 0 ? f.fill(a.adHocCount, { count: adHoc }) : undefined} />
        <Figure f={f} label={a.prsInPeriod} value={f.count(cur.prs)} change={c?.prs} format={f.count} />
        {data.streak ? (
          <>
            <Figure f={f} label={a.currentStreak} value={`${data.streak.current} ${a.daysUnit}`} />
            <Figure f={f} label={a.longestStreak} value={`${data.streak.longest} ${a.daysUnit}`} />
          </>
        ) : null}
      </View>
      {data.charts ? (
        <Bars f={f} title={a.workoutsChart} unit={data.buckets.unit} items={data.buckets.items} value={(b) => b.workouts} format={f.count} />
      ) : null}
      <Text onPress={web("/streak")} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{`${a.streakCalendar} →`}</Text>
    </View>
  );
}

const styles = {
  ...StyleSheet.create({
    // 110 at the bottom: clear of the floating tab bar.
    body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 18 },
    pill: { height: 36, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 18, paddingHorizontal: 14 },
    grid2: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    stat: { flexBasis: "47%", flexGrow: 1, alignItems: "center", gap: 10, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 20 },
    figure: { flexBasis: "47%", flexGrow: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14 },
    tabs: { flexDirection: "row", gap: 4, borderRadius: 16, padding: 4 },
    tab: { flex: 1, alignItems: "center", borderRadius: 12, paddingHorizontal: 4, paddingVertical: 10 },
    details: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
    listRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
    tableRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
    cell: { width: 92, textAlign: "right" },
    input: { height: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14 },
    goldButton: { height: 44, borderRadius: 16, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  }),
  label: (ink: string, size = 10) => ({ fontFamily: font.semibold, fontSize: size, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
  small: (ink: string, size = 12) => ({ fontFamily: font.regular, fontSize: size, color: ink }),
  prose: (ink: string) => ({ fontFamily: font.regular, fontSize: 12.5, lineHeight: 19, color: ink }),
};
