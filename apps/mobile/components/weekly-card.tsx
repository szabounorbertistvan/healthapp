import type { WeeklySummaryV1 } from "@healthapp/api/v1";
import { cmToDisplay, kgToDisplay, type Delta, type Insight } from "@healthapp/shared";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/role";
import { font, useTheme } from "@/lib/theme";
import { parseDay } from "@/lib/week";

// The week in one card — the web's components/weekly-summary.tsx on a phone:
// one headline insight, then training, nutrition, progress and consistency as
// rows (value, last week's, the change). Every number comes from
// packages/shared's comparison; this only formats. `onSwitch` shows the
// previous / current toggle.

function useFmt() {
  const { t, fill, locale } = useI18n();
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const nf = new Intl.NumberFormat(tag);
  const nf1 = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nfp = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" });
  const w = t.common.weekly;
  return {
    w,
    n: (v: number) => nf.format(v),
    n1: (v: number) => nf1.format(v),
    signed: (v: number) => `${v > 0 ? "+" : ""}${nf1.format(v)}`,
    date: (day: string) => df.format(parseDay(day)),
    duration: (min: number) => (min >= 60 ? fill(w.hours, { h: Math.floor(min / 60), m: min % 60 }) : fill(w.minutes, { m: min })),
    pctAbs: (v: number) => `${nfp.format(Math.abs(v))}%`,
    insight: (i: Insight): string => {
      const m = w.insight;
      switch (i.key) {
        case "load_up": return fill(m.load_up, { pct: nf1.format(i.pct) });
        case "load_down": return fill(m.load_down, { pct: nf1.format(i.pct) });
        case "more_workouts": return fill(m.more_workouts, { count: i.count });
        case "fewer_workouts": return fill(m.fewer_workouts, { count: i.count });
        case "prs": return fill(m.prs, { count: i.count });
        case "volume_up": return fill(m.volume_up, { pct: nf1.format(i.pct) });
        case "volume_down": return fill(m.volume_down, { pct: nf1.format(i.pct) });
        case "all_planned_done": return m.all_planned_done;
        case "nutrition_adherence": return fill(m.nutrition_adherence, { pct: i.pct });
        case "weight_change": return fill(m.weight_change, { delta: `${i.delta > 0 ? "+" : ""}${nf1.format(i.delta)}` });
        case "no_data": return m.no_data;
      }
    },
  };
}

export function WeeklyCard({ summary: s, onSwitch }: { summary: WeeklySummaryV1; onSwitch?: (week: "current" | "previous") => void }) {
  const { fill } = useI18n();
  const { color } = useTheme();
  const f = useFmt();
  const w = f.w;
  const me = useMe().data?.data;
  const unit = me?.weight_unit ?? "kg";
  const length = unit === "lb" ? "in" : "cm";
  const cur = s.current;
  const prev = s.previous;
  const n = cur.nutrition;
  const p = cur.progress;
  const c = cur.consistency;
  const hasProgress = p.weight !== null || p.waist !== null || Object.keys(p.others).length > 0;
  const [headline, ...rest] = s.insights;
  const prevIf = (v: number) => (v > 0 ? f.n(v) : null);

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{w.title}</Text>
          <Text style={{ marginTop: 2, fontFamily: font.bold, fontSize: 14, color: color.ink }}>{`${f.date(cur.week.start)} – ${f.date(cur.week.end)}`}</Text>
        </View>
        {onSwitch ? (
          <View style={[styles.switch, { borderColor: color.line }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={w.previousWeek} onPress={() => onSwitch("previous")} style={[styles.switchItem, s.choice === "previous" ? { backgroundColor: color.accent } : null]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12, color: s.choice === "previous" ? color.accentFg : color.inkSoft }}>‹</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => onSwitch("current")} style={[styles.switchItem, s.choice === "current" ? { backgroundColor: color.accent } : null]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12, color: s.choice === "current" ? color.accentFg : color.inkSoft }}>{s.choice === "current" ? w.currentWeek : w.previousWeek}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {headline ? (
        <View style={[styles.headline, { backgroundColor: color.accentSoft }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 14, lineHeight: 19, color: color.accentInk }}>{f.insight(headline)}</Text>
          {rest.length > 0 ? <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.inkSoft }}>{rest.map(f.insight).join(" · ")}</Text> : null}
        </View>
      ) : null}

      <Section title={w.training}>
        <Row label={w.workouts} value={f.n(cur.training.workouts)} previous={prevIf(prev.training.workouts)} delta={s.training.workouts} />
        <Row label={w.duration} value={cur.training.duration_min > 0 ? f.duration(cur.training.duration_min) : "—"} previous={prev.training.duration_min > 0 ? f.duration(prev.training.duration_min) : null} delta={cur.training.duration_min > 0 ? s.training.duration_min : null} />
        <Row label={w.trainingLoad} value={f.n(cur.training.load)} previous={prevIf(prev.training.load)} delta={s.training.load} />
        <Row label={w.volume} value={`${f.n(cur.training.volume_kg)} kg`} previous={prevIf(prev.training.volume_kg)} delta={s.training.volume_kg} />
        <Row label={w.sets} value={f.n(cur.training.sets)} previous={prevIf(prev.training.sets)} delta={s.training.sets} />
        <Row label={w.exercises} value={f.n(cur.training.exercises)} previous={prevIf(prev.training.exercises)} delta={s.training.exercises} />
        {cur.training.prs > 0 ? (
          <View style={{ paddingVertical: 8, gap: 6 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.accentInk }}>{cur.training.prs === 1 ? w.newPrOne : fill(w.newPrs, { count: cur.training.prs })}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {cur.training.pr_lifts.slice(0, 6).map((pr, i) => (
                <View key={i} style={[styles.pr, { backgroundColor: color.bg }]}>
                  <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkSoft }}>
                    <Text style={{ fontFamily: font.semibold, color: color.ink }}>{pr.exercise}</Text>
                    {` ${f.n1(pr.weight_kg)} × ${pr.reps}`}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </Section>

      <Section title={w.nutrition} aside={n.avg ? fill(w.daysLogged, { count: n.days_logged }) : undefined}>
        {n.avg ? (
          <>
            <Row label={w.kcalPerDay} value={f.n(n.avg.kcal)} previous={prevIf(prev.nutrition.avg?.kcal ?? 0)} delta={s.nutrition.kcal} />
            <Row label={w.proteinPerDay} value={f.n(n.avg.protein)} previous={prevIf(prev.nutrition.avg?.protein ?? 0)} delta={s.nutrition.protein} />
            <Row label={w.carbsPerDay} value={f.n(n.avg.carbs)} previous={prevIf(prev.nutrition.avg?.carbs ?? 0)} delta={s.nutrition.carbs} />
            <Row label={w.fatPerDay} value={f.n(n.avg.fat)} previous={prevIf(prev.nutrition.avg?.fat ?? 0)} delta={s.nutrition.fat} />
            <Row label={w.adherence} value={n.adherence_pct === null ? w.noData : `${n.adherence_pct}%`} previous={prev.nutrition.adherence_pct !== null ? `${prev.nutrition.adherence_pct}%` : null} delta={n.adherence_pct === null ? null : s.nutrition.adherence_pct} />
          </>
        ) : <Empty>{w.noData}</Empty>}
      </Section>

      <Section title={w.progress}>
        {hasProgress ? (
          <>
            {p.weight ? <Row label={w.weight} value={`${f.signed(kgToDisplay(p.weight.delta, unit))} ${unit}`} previous={`${f.n1(kgToDisplay(p.weight.start, unit))} → ${f.n1(kgToDisplay(p.weight.end, unit))}`} /> : null}
            {p.waist ? <Row label={w.waist} value={`${f.signed(cmToDisplay(p.waist.delta, length))} ${length}`} previous={`${f.n1(cmToDisplay(p.waist.start, length))} → ${f.n1(cmToDisplay(p.waist.end, length))}`} /> : null}
            {Object.entries(p.others).map(([name, ch]) => (
              <Row key={name} label={name} value={`${f.signed(cmToDisplay(ch.delta, length))} ${length}`} previous={`${f.n1(cmToDisplay(ch.start, length))} → ${f.n1(cmToDisplay(ch.end, length))}`} />
            ))}
          </>
        ) : <Empty>{w.noData}</Empty>}
      </Section>

      <Section title={w.consistency}>
        {c.completion_pct !== null ? (
          <Row label={w.plannedWorkouts} value={`${cur.training.workouts} / ${c.planned_workouts} · ${c.completion_pct}%`} previous={prev.consistency.completion_pct !== null ? `${prev.consistency.completion_pct}%` : null} delta={s.consistency.completion_pct} />
        ) : null}
        <Row label={w.activeDays} value={`${c.active_days} / 7`} previous={prevIf(prev.consistency.active_days)} delta={s.consistency.active_days} />
        <Row label={w.workoutDays} value={f.n(c.workout_days)} previous={prevIf(prev.consistency.workout_days)} delta={s.consistency.workout_days} />
        {c.streak_days > 0 ? <Row label={w.streak} value={`${f.n(c.streak_days)} ${w.streakDays}`} /> : null}
        {c.completion_pct !== null ? (
          <View style={[styles.track, { backgroundColor: color.bg }]}>
            <View style={{ width: `${c.completion_pct}%`, height: "100%", borderRadius: 3, backgroundColor: c.completion_pct >= 80 ? color.accent : c.completion_pct >= 50 ? color.warn : color.risk }} />
          </View>
        ) : null}
      </Section>
    </Card>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  const { color } = useTheme();
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{title}</Text>
        {aside ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{aside}</Text> : null}
      </View>
      <View style={{ marginTop: 2 }}>{children}</View>
    </View>
  );
}

function Empty({ children }: { children: ReactNode }) {
  const { color } = useTheme();
  return <Text style={{ paddingVertical: 6, fontFamily: font.regular, fontSize: 13.5, color: color.inkFaint }}>{children}</Text>;
}

function Row({ label, value, previous, delta }: { label: string; value: string; previous?: string | null; delta?: Delta | null }) {
  const { color } = useTheme();
  const f = useFmt();
  const tone = !delta || delta.pct === null ? null
    : delta.direction === "up" ? { bg: color.accentSoft, ink: color.accentInk, arrow: "▲" }
    : delta.direction === "down" ? { bg: color.warnSoft, ink: color.warn, arrow: "▼" }
    : { bg: color.bg, ink: color.inkFaint, arrow: "•" };
  return (
    <View style={[styles.row, { borderTopColor: color.line }]}>
      <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft }}>{label}</Text>
      <Text style={{ fontFamily: font.bold, fontSize: 13.5, color: color.ink }}>
        {value}
        {previous ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{`  ← ${previous}`}</Text> : null}
      </Text>
      <View style={[styles.pill, { backgroundColor: tone?.bg ?? "transparent" }]}>
        {tone && delta?.pct != null ? <Text style={{ fontFamily: font.semibold, fontSize: 10.5, color: tone.ink }}>{`${tone.arrow} ${f.pctAbs(delta.pct)}`}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  switch: { flexDirection: "row", borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  switchItem: { minHeight: 34, paddingHorizontal: 12, justifyContent: "center" },
  headline: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  pr: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth },
  pill: { width: 58, alignItems: "flex-end", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  track: { height: 6, borderRadius: 3, overflow: "hidden", marginTop: 8 },
});
