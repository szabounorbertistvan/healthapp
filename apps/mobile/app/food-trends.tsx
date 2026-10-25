import type { NutritionTrendsV1 } from "@healthapp/api/v1";
import { macroAdherence, NUTRITION_SLOTS, PARTIAL_DAY_MAX_MEALS, periodChange, type MacroLine, type Macros, type NutritionInsight, type PeriodChange } from "@healthapp/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, T } from "@/components/ui";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";
import { parseDay } from "@/lib/week";

// Nutrition trends — the web's /food?view=trends on a phone
// (components/nutrition-trends.tsx): a range, today against the target, the
// insights, the period's averages and adherence, one chart at a time, how
// completely the diary was kept, the meals' share, this week against the last,
// the plan, and the logged days. Every number arrives folded on the server.

type Range = 7 | 30 | 90 | 365 | null;
type Chart = "kcal" | "protein" | "carbs" | "fat";
const RANGES: Range[] = [7, 30, 90, 365, null];

function useFmt() {
  const { t, locale } = useI18n();
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const n0 = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" });
  return {
    n: t.clientApp.nutritionTrends,
    a: t.clientApp.advancedProgress,
    m: t.common.macros,
    kcal: (v: number) => `${n0.format(v)} kcal`,
    g: (v: number) => `${n1.format(v)} g`,
    pct: (v: number) => n1.format(v),
    count: (v: number) => n0.format(v),
    date: (day: string) => df.format(parseDay(day)),
  };
}
type Fmt = ReturnType<typeof useFmt>;

export default function FoodTrends() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const f = useFmt();
  const [range, setRange] = useState<Range>(30);
  const query = useQuery({ queryKey: ["food-trends", range], queryFn: () => api.foodTrends(range === null ? "all" : String(range)), placeholderData: (p) => p });
  const d = query.data;
  const rangeLabel = (r: Range) => (r === null ? f.a.rangeAll : r === 7 ? f.a.range7 : r === 30 ? f.a.range30 : r === 90 ? f.a.range90 : f.a.range365);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={f.n.diary} />
        <T kind="title">{f.n.trends}</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {RANGES.map((r) => (
            <Pressable key={String(r)} accessibilityRole="tab" accessibilityState={{ selected: r === range }} onPress={() => setRange(r)} style={[styles.pill, { backgroundColor: r === range ? color.accent : color.surface }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: r === range ? color.accentFg : color.inkSoft }}>{rangeLabel(r)}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {!d ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <T kind="faint">{d.range === null ? f.a.allTimeNoCompare : d.progress.previous !== null ? fill(f.a.vsPrevious, { days: d.range }) : f.a.noPrevious}</T>
            {d.truncated ? <T kind="faint">{f.n.truncated}</T> : null}
            <TodayCard d={d} f={f} />
            <Insights insights={d.insights} f={f} />
            <PeriodCard d={d} f={f} />
            <ChartCard d={d} f={f} />
            <LoggingCard d={d} f={f} />
            <MealsCard d={d} f={f} />
            <WeekCard d={d} f={f} />
            {d.plan ? (
              <Card style={{ gap: 6 }}>
                <Eyebrow aside={d.plan.owner === "coach" ? f.n.planBy : f.n.planByYou}>{f.n.plan}</Eyebrow>
                <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{d.plan.name}</Text>
                {d.today.target ? <T kind="faint">{macroLine(d.today.target, f)}</T> : null}
                <T kind="label">{f.n.plannedToday}</T>
                <T kind="soft">
                  {d.plan.planned_meals > 0 && d.plan.planned_kcal !== null ? fill(f.n.plannedKcal, { kcal: f.count(d.plan.planned_kcal), meals: d.plan.planned_meals }) : f.n.noPlannedMeals}
                </T>
              </Card>
            ) : null}
            <History d={d} f={f} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const macroLine = (m: Macros, f: Fmt) => `${f.kcal(m.kcal)} · ${f.m.protein} ${f.g(m.protein)} · ${f.m.carbs} ${f.g(m.carbs)} · ${f.m.fat} ${f.g(m.fat)}`;

function Eyebrow({ children, aside }: { children: ReactNode; aside?: string }) {
  const { color } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
      <T kind="label">{children}</T>
      {aside ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{aside}</Text> : null}
    </View>
  );
}

/** A figure and, when there is a period to compare with, where it came from (advanced-progress.tsx Figure). */
function Figure({ label, value, change, format, hint, f }: { label: string; value: string; change?: PeriodChange | null; format?: (v: number) => string; hint?: string; f: Fmt }) {
  const { fill } = useI18n();
  const { color } = useTheme();
  return (
    <View style={[styles.figure, { backgroundColor: color.bg }]}>
      <Text style={{ fontFamily: font.semibold, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: color.inkFaint }}>{label}</Text>
      <Text style={{ marginTop: 2, fontFamily: font.displayExtrabold, fontSize: 19, color: color.ink }}>{value}</Text>
      {change && format ? (
        <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>
          {`${fill(f.a.previousValue, { value: format(change.previous) })} · `}
          <Text style={{ fontFamily: font.semibold, color: change.delta > 0 ? color.accentInk : color.inkSoft }}>
            {`${change.delta > 0 ? "+" : change.delta < 0 ? "−" : "±"}${format(Math.abs(change.delta))}${change.pct !== null && change.delta !== 0 ? ` (${change.delta > 0 ? "+" : "−"}${f.pct(change.pct)}%)` : ""}`}
          </Text>
        </Text>
      ) : null}
      {hint ? <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 10.5, color: color.inkFaint }}>{hint}</Text> : null}
    </View>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

/** consumed / target, a clamped bar, the percentage and the difference. */
function Adherence({ label, line, fmt, f }: { label: string; line: MacroLine; fmt: (v: number) => string; f: Fmt }) {
  const { fill } = useI18n();
  const { color } = useTheme();
  const width = line.pct === null ? 0 : Math.min(Math.max(line.pct, 0), 100);
  const over = line.pct !== null && line.pct > 100;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{label}</Text>
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>
          <Text style={{ fontFamily: font.bold, color: color.ink }}>{fmt(line.consumed)}</Text>
          {line.target !== null ? ` / ${fmt(line.target)}` : ""}
        </Text>
      </View>
      {line.target !== null ? (
        <>
          <View style={[styles.track, { backgroundColor: color.bg }]}>
            <View style={{ width: `${width}%`, height: "100%", borderRadius: 4, backgroundColor: over ? color.warn : color.accent }} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{fill(f.n.ofTarget, { pct: f.pct(line.pct ?? 0) })}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>
              {`${f.n.difference} ${line.difference! > 0 ? "+" : line.difference! < 0 ? "−" : ""}${fmt(Math.abs(line.difference!))}`}
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

function TodayCard({ d, f }: { d: NutritionTrendsV1; f: Fmt }) {
  const { fill } = useI18n();
  const { color } = useTheme();
  const aside = fill(f.n.mealsLogged, { count: d.today.meals });
  if (d.today.target === null) {
    return (
      <Card style={{ gap: 6 }}>
        <Eyebrow aside={aside}>{f.n.today}</Eyebrow>
        <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{f.n.noTarget}</Text>
        <T kind="soft">{f.n.noTargetHint}</T>
        <T kind="faint">{macroLine(d.today.totals, f)}</T>
      </Card>
    );
  }
  const a = macroAdherence(d.today.totals, d.today.target);
  return (
    <Card style={{ gap: 12 }}>
      <Eyebrow aside={aside}>{f.n.today}</Eyebrow>
      <Adherence label={f.m.calories} line={a.kcal} fmt={f.kcal} f={f} />
      <Adherence label={f.m.protein} line={a.protein} fmt={f.g} f={f} />
      <Adherence label={f.m.carbs} line={a.carbs} fmt={f.g} f={f} />
      <Adherence label={f.m.fat} line={a.fat} fmt={f.g} f={f} />
    </Card>
  );
}

function Insights({ insights, f }: { insights: NutritionInsight[]; f: Fmt }) {
  const { fill } = useI18n();
  const { color } = useTheme();
  const n = f.n;
  const sentence = (i: NutritionInsight): string => {
    switch (i.key) {
      case "insufficient_data": return fill(n.insightInsufficient, { min: i.min, days: i.days_logged });
      case "avg_kcal": return fill(n.insightAvgKcal, { value: f.count(i.value) });
      case "kcal_vs_target": return Math.abs(i.pct) < 0.05 ? n.insightKcalOn : fill(i.pct < 0 ? n.insightKcalBelow : n.insightKcalAbove, { pct: f.pct(Math.abs(i.pct)) });
      case "avg_protein": return fill(n.insightAvgProtein, { value: f.pct(i.value) });
      case "protein_reached": return fill(n.insightProteinReached, { days: i.days, logged: i.logged });
      case "logging": return fill(n.insightLogging, { days: i.days, total: i.window_days });
      case "kcal_change": return fill(i.pct > 0 ? n.insightKcalUp : n.insightKcalDown, { pct: f.pct(Math.abs(i.pct)) });
      case "protein_change": return fill(i.pct > 0 ? n.insightProteinUp : n.insightProteinDown, { pct: f.pct(Math.abs(i.pct)) });
    }
  };
  return (
    <Card style={{ gap: 8 }}>
      <Eyebrow>{n.insights}</Eyebrow>
      {insights.map((i) => (
        <View key={i.key} style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ marginTop: 7, width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent }} />
          <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.ink }}>{sentence(i)}</Text>
        </View>
      ))}
    </Card>
  );
}

function PeriodCard({ d, f }: { d: NutritionTrendsV1; f: Fmt }) {
  const { fill } = useI18n();
  const n = f.n;
  const cur = d.progress.current;
  const c = d.progress.changes;
  const avg = cur.avg;
  const labelOf = (k: "kcal" | "protein" | "carbs" | "fat") => (k === "kcal" ? f.m.calories : f.m[k]);
  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow aside={fill(n.daysLoggedValue, { days: cur.days_logged, total: cur.window_days })}>{n.period}</Eyebrow>
      {avg === null ? <T kind="faint">{n.noData}</T> : (
        <>
          <Grid>
            <Figure f={f} label={n.avgCalories} value={f.kcal(avg.kcal)} change={c?.kcal} format={f.kcal} />
            <Figure f={f} label={n.avgProtein} value={f.g(avg.protein)} change={c?.protein} format={f.g} />
            <Figure f={f} label={n.avgCarbs} value={f.g(avg.carbs)} change={c?.carbs} format={f.g} />
            <Figure f={f} label={n.avgFat} value={f.g(avg.fat)} change={c?.fat} format={f.g} />
          </Grid>
          <T kind="faint">{n.avgNote}</T>
          {d.today.target !== null && cur.adherence && cur.days_reached && cur.days_within ? (
            <View style={{ gap: 12, marginTop: 4 }}>
              {cur.kcal_score !== null ? <Grid><Figure f={f} label={n.calorieAdherence} value={`${f.pct(cur.kcal_score)}%`} hint={n.calorieAdherenceHint} /></Grid> : null}
              {(["kcal", "protein", "carbs", "fat"] as const).map((k) =>
                cur.adherence![k].target === null ? null : (
                  <View key={k} style={{ gap: 2 }}>
                    <Adherence label={labelOf(k)} line={cur.adherence![k]} fmt={k === "kcal" ? f.kcal : f.g} f={f} />
                    <T kind="faint">{`${fill(n.reachedDays, { days: cur.days_reached![k], logged: cur.days_logged })} · ${fill(n.withinDays, { days: cur.days_within![k], logged: cur.days_logged })}`}</T>
                  </View>
                ),
              )}
              <T kind="faint">{n.targetNote}</T>
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** One chart at a time: bars per day / week / month, the target as a line, a hairline where nothing was logged. */
function ChartCard({ d, f }: { d: NutritionTrendsV1; f: Fmt }) {
  const { color } = useTheme();
  const n = f.n;
  const [chart, setChart] = useState<Chart>("kcal");
  const labels: Record<Chart, string> = { kcal: n.chartKcal, protein: n.chartProtein, carbs: n.chartCarbs, fat: n.chartFat };
  const items = d.series.items;
  const values = items.map((b) => b[chart]);
  const peak = Math.max(0, ...values.map((v) => v ?? 0));
  const target = d.today.target?.[chart] ?? null;
  const tgt = target !== null && target > 0 ? target : null;
  const scale = Math.max(peak, tgt ?? 0) * 1.05;
  const format = chart === "kcal" ? f.kcal : f.g;
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <Card style={{ gap: 12 }}>
      <Eyebrow>{n.charts}</Eyebrow>
      <View style={[styles.seg, { backgroundColor: color.bg }]}>
        {(["kcal", "protein", "carbs", "fat"] as const).map((c) => (
          <Pressable key={c} accessibilityRole="tab" accessibilityState={{ selected: c === chart }} onPress={() => { setChart(c); setPicked(null); }} style={[styles.segItem, c === chart ? { backgroundColor: color.surface } : null]}>
            <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 12, color: c === chart ? color.ink : color.inkSoft }}>{labels[c]}</Text>
          </Pressable>
        ))}
      </View>
      {peak === 0 ? <T kind="faint">{n.noData}</T> : (
        <View>
          <View style={{ height: 128 }}>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
              {items.map((b, i) => {
                const v = values[i];
                return (
                  <Pressable
                    key={b.start}
                    accessibilityLabel={`${f.date(b.start)} · ${v === null ? n.notLogged : format(v)}`}
                    onPress={() => (d.series.unit === "day" ? router.push({ pathname: "/(tabs)/food", params: { day: b.start } }) : setPicked(i))}
                    onLongPress={() => setPicked(i)}
                    style={{ flex: 1, height: "100%", justifyContent: "flex-end" }}
                  >
                    <View style={{ height: v === null ? 2 : `${Math.max((v / scale) * 100, 2)}%`, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: v === null ? color.line : tgt !== null && v > tgt * 1.1 ? color.warn : color.accent, opacity: picked === null || picked === i ? 1 : 0.5 }} />
                  </Pressable>
                );
              })}
            </View>
            {tgt !== null ? <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: `${(tgt / scale) * 100}%`, borderTopWidth: 1, borderStyle: "dashed", borderColor: color.inkSoft }} /> : null}
          </View>
          <View style={{ marginTop: 6, flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{items[0] ? f.date(items[0].start) : ""}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{d.series.unit === "day" ? n.perDay : d.series.unit === "week" ? n.perWeek : n.perMonth}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{items.length ? f.date(items[items.length - 1]!.start) : ""}</Text>
          </View>
          {picked !== null && items[picked] ? (
            <Text style={{ marginTop: 4, fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{`${f.date(items[picked]!.start)} · ${values[picked] === null ? n.notLogged : format(values[picked]!)}`}</Text>
          ) : null}
        </View>
      )}
    </Card>
  );
}

function LoggingCard({ d, f }: { d: NutritionTrendsV1; f: Fmt }) {
  const { fill } = useI18n();
  const n = f.n;
  const cur = d.progress.current;
  const c = d.progress.changes;
  const share = cur.tracked_days > 0 ? (cur.days_logged / cur.tracked_days) * 100 : null;
  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow>{n.logging}</Eyebrow>
      {cur.tracked_days === 0 ? <T kind="faint">{n.noData}</T> : (
        <>
          <Grid>
            <Figure f={f} label={n.daysWithLog} value={fill(n.daysOf, { days: cur.days_logged, total: cur.tracked_days })} change={c?.days_logged} format={f.count} hint={share === null ? undefined : fill(n.loggedShare, { pct: f.count(share) })} />
            <Figure f={f} label={n.noDataDays} value={f.count(cur.unlogged_days)} hint={n.noDataHint} />
            <Figure f={f} label={n.longestRun} value={fill(n.daysValue, { days: cur.longest_run })} />
            <Figure f={f} label={n.partialDays} value={f.count(cur.partial_days)} change={c?.partial_days} format={f.count} hint={fill(n.partialHint, { meals: PARTIAL_DAY_MAX_MEALS })} />
          </Grid>
          {cur.tracked_days < cur.window_days ? <T kind="faint">{fill(n.trackedNote, { days: cur.tracked_days })}</T> : null}
        </>
      )}
    </Card>
  );
}

function MealsCard({ d, f }: { d: NutritionTrendsV1; f: Fmt }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const n = f.n;
  const meals = d.meals;
  const slotName = t.clientApp.food as unknown as Record<string, string>;
  const tones = [color.accent, color.warn, color.inkSoft, color.inkFaint];
  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow>{n.meals}</Eyebrow>
      {meals === null ? <T kind="faint">{n.detailTooLong}</T> : meals.logged_days === 0 ? <T kind="faint">{n.noData}</T> : (
        <>
          <View style={[styles.split, { backgroundColor: color.bg }]}>
            {NUTRITION_SLOTS.map((slot, i) => {
              const s = meals.slots[slot].kcal_share ?? 0;
              return s > 0 ? <View key={slot} style={{ width: `${s}%`, backgroundColor: tones[i] }} /> : null;
            })}
          </View>
          {NUTRITION_SLOTS.map((slot, i) => {
            const s = meals.slots[slot];
            return (
              <View key={slot} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tones[i] }} />
                <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{slotName[slot]}</Text>
                <Text style={{ width: 44, textAlign: "right", fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{s.kcal_share === null ? "—" : `${f.count(s.kcal_share)}%`}</Text>
                <Text style={{ width: 84, textAlign: "right", fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{s.avg === null ? "—" : f.kcal(s.avg.kcal)}</Text>
                <Text style={{ width: 54, textAlign: "right", fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{fill(n.daysOf, { days: s.days, total: meals.logged_days })}</Text>
              </View>
            );
          })}
          <T kind="faint">{n.mealsNote}</T>
        </>
      )}
    </Card>
  );
}

function WeekCard({ d, f }: { d: NutritionTrendsV1; f: Fmt }) {
  const { fill } = useI18n();
  const { color } = useTheme();
  const n = f.n;
  const { current: cur, previous: prev } = d.week;
  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow aside={fill(n.daysLoggedValue, { days: cur.days_logged, total: cur.window_days })}>{n.week}</Eyebrow>
      <T kind="faint">{n.weekHint}</T>
      {cur.avg === null ? <T kind="faint">{n.noData}</T> : (
        <>
          <Grid>
            <Figure f={f} label={n.avgCalories} value={f.kcal(cur.avg.kcal)} change={periodChange(cur.avg.kcal, prev.avg?.kcal)} format={f.kcal} />
            <Figure f={f} label={n.avgProtein} value={f.g(cur.avg.protein)} change={periodChange(cur.avg.protein, prev.avg?.protein)} format={f.g} />
            <Figure f={f} label={n.avgCarbs} value={f.g(cur.avg.carbs)} change={periodChange(cur.avg.carbs, prev.avg?.carbs)} format={f.g} />
            <Figure f={f} label={n.avgFat} value={f.g(cur.avg.fat)} change={periodChange(cur.avg.fat, prev.avg?.fat)} format={f.g} />
          </Grid>
          {cur.highest && cur.lowest ? (
            <>
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{`${n.highest}: ${f.date(cur.highest.day)} · ${f.kcal(cur.highest.kcal)}`}</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{`${n.lowest}: ${f.date(cur.lowest.day)} · ${f.kcal(cur.lowest.kcal)}`}</Text>
            </>
          ) : null}
          {d.today.target !== null && cur.kcal_score !== null ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{`${n.calorieAdherence}: ${f.pct(cur.kcal_score)}%`}</Text> : null}
        </>
      )}
    </Card>
  );
}

function History({ d, f }: { d: NutritionTrendsV1; f: Fmt }) {
  const { fill } = useI18n();
  const { color } = useTheme();
  const n = f.n;
  const shown = d.days.slice(0, 31);
  const target = d.today.target;
  return (
    <Card style={{ gap: 4 }}>
      <Eyebrow>{n.history}</Eyebrow>
      <T kind="faint">{n.historyHint}</T>
      {shown.length === 0 ? <T kind="faint">{n.noData}</T> : null}
      {shown.map((day, i) => {
        const over = target !== null && target.kcal > 0 && day.kcal > target.kcal * 1.1;
        return (
          <Pressable key={day.day} accessibilityRole="link" onPress={() => router.push({ pathname: "/(tabs)/food", params: { day: day.day } })} style={[styles.row, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line } : null]}>
            <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>
              {f.date(day.day)}
              {day.day === d.today_iso ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{`  ${n.inProgress}`}</Text> : null}
            </Text>
            <Text style={{ width: 60, textAlign: "right", fontFamily: font.regular, fontSize: 12.5, color: over ? color.warn : color.ink }}>{f.count(day.kcal)}</Text>
            <Text style={{ width: 70, textAlign: "right", fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{`${f.m.protein[0]} ${f.g(day.protein)}`}</Text>
            <Text style={{ width: 60, textAlign: "right", fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
              {`${day.meals}${day.day !== d.today_iso && day.meals <= PARTIAL_DAY_MAX_MEALS ? ` · ${n.partialTag}` : ""}`}
            </Text>
          </Pressable>
        );
      })}
      {d.days.length > shown.length ? <T kind="faint">{fill(n.historyMore, { count: d.days.length - shown.length })}</T> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  pill: { height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
  figure: { flexGrow: 1, flexBasis: "45%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  seg: { flexDirection: "row", borderRadius: 12, padding: 4, gap: 4 },
  segItem: { flex: 1, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  split: { height: 12, borderRadius: 6, overflow: "hidden", flexDirection: "row" },
  row: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
});
