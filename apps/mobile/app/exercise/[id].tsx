import type { ExerciseDetailV1 } from "@healthapp/api/v1";
import { formatDecimal } from "@healthapp/i18n";
import { formatWeight, kgToDisplay } from "@healthapp/shared";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PointsChart } from "@/components/charts";
import { absolute } from "@/components/post-card";
import { Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/role";
import { font, useTheme } from "@/lib/theme";

// One exercise — the web's /exercises/[id] on a phone: the muscles and facts,
// your performance on it (last, best weight, est. 1RM, volume…), the progress
// line, rep records, every session newest first, then the demo and the how-to.
// Everything below the header is the reader's own logged sets.

type Metric = "weight" | "e1rm" | "volume";

export default function ExerciseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const d = t.clientApp.exerciseDetail;
  const unit = useMe().data?.data.weight_unit ?? "kg";
  const query = useQuery({ queryKey: ["exercise", id], queryFn: () => api.exercise(id) });
  const x = query.data;
  const kg = (v: number | null | undefined) => (v == null ? "—" : formatWeight(v, unit, { locale }));
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  const [metric, setMetric] = useState<Metric>("weight");

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={d.back} />
        {!x ? (
          query.isError ? <T kind="soft">{d.notFound}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <View style={{ gap: 8 }}>
              <T kind="title">{x.name}</T>
              <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
                {x.primary_muscles.length > 0 ? <Fact label={d.primaryMuscle} value={x.primary_muscles.join(", ")} accent /> : null}
                {x.secondary_muscles.length > 0 ? <Fact label={d.secondaryMuscles} value={x.secondary_muscles.join(", ")} /> : null}
                {x.facts.map((f) => <Fact key={f.key} label={d[f.key]} value={f.value} />)}
              </View>
            </View>
            {x.image ? <Image source={{ uri: absolute(x.image) }} style={styles.image} resizeMode="cover" /> : null}

            {x.stats.sessions === 0 ? (
              <Card style={{ gap: 4 }}>
                <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{d.noHistoryTitle}</Text>
                <T kind="soft">{d.noHistoryHint}</T>
              </Card>
            ) : (
              <>
                <Summary x={x} kg={kg} nf={nf} />
                {x.charts_locked ? null : <Progress x={x} metric={metric} setMetric={setMetric} unit={unit} />}
                {!x.charts_locked && x.records.length > 0 ? (
                  <Card style={{ gap: 8 }}>
                    <T kind="label">{d.repRecords}</T>
                    <T kind="faint">{d.repRecordsHint}</T>
                    {x.records.map((r) => (
                      <View key={r.reps} style={styles.line}>
                        <Text style={{ width: 64, fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{`${r.reps} ${d.repsUnit}`}</Text>
                        <Text style={{ flex: 1, fontFamily: font.displayBold, fontSize: 15, color: color.ink }}>{kg(r.weight_kg)}</Text>
                        <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{date(r.at)}</Text>
                      </View>
                    ))}
                  </Card>
                ) : null}
                <View style={{ gap: 8 }}>
                  <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{d.history}</Text>
                  <T kind="faint">{d.historyHint}</T>
                  {x.sessions.map((s) => (
                    <Card key={s.session_id} style={{ gap: 6 }}>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                        <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{s.name ?? date(s.at)}</Text>
                        <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{date(s.at)}</Text>
                      </View>
                      <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 20, color: color.inkSoft }}>
                        {s.sets.map((set) => `${set.duration_seconds ? `${set.duration_seconds}s` : `${set.weight_kg > 0 ? `${formatDecimal(kgToDisplay(set.weight_kg, unit), locale)} × ` : ""}${set.reps}`}${set.is_pr ? ` ${d.pr}` : ""}${set.warmup ? ` (${d.warmup})` : ""}`).join("  ·  ")}
                      </Text>
                      {s.volume_kg > 0 ? <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{`${d.volume} ${kg(s.volume_kg)}`}</Text> : null}
                    </Card>
                  ))}
                  {x.history_cut ? <T kind="faint">{t.mobile.exercise.historyCut}</T> : null}
                  {x.truncated ? <T kind="faint">{d.truncated}</T> : null}
                </View>
              </>
            )}

            {x.video_url || x.steps.length > 0 ? (
              <Card style={{ gap: 10 }}>
                {x.video_url ? (
                  <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(x.video_url!)} style={[styles.video, { backgroundColor: color.bg }]}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.accentInk }}>{`▶ ${t.mobile.exercise.watchDemo}`}</Text>
                  </Pressable>
                ) : null}
                {x.steps.length > 0 ? (
                  <>
                    <T kind="label">{d.howTo}</T>
                    {x.steps.map((step, i) => (
                      <View key={i} style={{ flexDirection: "row", gap: 10 }}>
                        <View style={[styles.step, { backgroundColor: color.accentSoft }]}>
                          <Text style={{ fontFamily: font.bold, fontSize: 11, color: color.accentInk }}>{i + 1}</Text>
                        </View>
                        <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{step}</Text>
                      </View>
                    ))}
                  </>
                ) : null}
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Fact({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  const { color } = useTheme();
  return (
    <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
      {`${label} `}
      <Text style={{ fontFamily: font.semibold, color: accent ? color.accentInk : color.inkSoft, textTransform: "capitalize" }}>{value}</Text>
    </Text>
  );
}

/** Performance: the tiles the web's summary shows, reps first for a bodyweight lift. */
function Summary({ x, kg, nf }: { x: ExerciseDetailV1; kg: (v: number | null | undefined) => string; nf: Intl.NumberFormat }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const d = t.clientApp.exerciseDetail;
  const s = x.stats;
  const tiles = s.bodyweight
    ? [
        { k: d.maxReps, v: s.best_reps == null ? "—" : String(s.best_reps) },
        { k: d.sessions, v: nf.format(s.sessions) },
        { k: d.totalSets, v: nf.format(s.total_sets) },
      ]
    : [
        { k: d.bestWeight, v: kg(s.best_weight_kg), hint: s.best_reps_at_best_weight ? fill(d.repsAtBestWeight, { reps: s.best_reps_at_best_weight }) : null },
        { k: d.estimated1rm, v: kg(s.best_1rm) },
        { k: d.bestVolume, v: kg(s.best_volume_kg) },
        { k: d.bestReps, v: s.best_reps == null ? "—" : String(s.best_reps) },
        { k: d.sessions, v: nf.format(s.sessions) },
        { k: d.totalVolume, v: kg(s.total_volume_kg) },
      ];
  return (
    <Card style={{ gap: 10 }}>
      <T kind="label">{d.summary}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 12 }}>
        {tiles.map((tile) => (
          <View key={tile.k} style={{ width: "50%", paddingRight: 8 }}>
            <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{tile.k}</Text>
            <Text style={{ fontFamily: font.displayExtrabold, fontSize: 19, color: color.ink }}>{tile.v}</Text>
            {"hint" in tile && tile.hint ? <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{tile.hint}</Text> : null}
          </View>
        ))}
      </View>
    </Card>
  );
}

/** The progress line — top weight, estimated 1RM or volume per session, oldest first. */
function Progress({ x, metric, setMetric, unit }: { x: ExerciseDetailV1; metric: Metric; setMetric: (m: Metric) => void; unit: "kg" | "lb" }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const d = t.clientApp.exerciseDetail;
  const labels: Record<Metric, string> = { weight: d.chartWeight, e1rm: d.chart1rm, volume: d.chartVolume };
  const points = [...x.sessions]
    .reverse()
    .map((s) => {
      const v = metric === "weight" ? s.top_weight_kg : metric === "volume" ? s.volume_kg : s.best_1rm;
      return v == null || v <= 0 ? null : { day: s.day ?? s.at.slice(0, 10), value: kgToDisplay(v, unit) };
    })
    .filter((p): p is { day: string; value: number } => p !== null);
  if (x.stats.bodyweight) return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={[styles.seg, { backgroundColor: color.surface }]}>
        {(["weight", "e1rm", "volume"] as const).map((m) => (
          <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: m === metric }} onPress={() => setMetric(m)} style={[styles.segItem, m === metric ? { backgroundColor: color.accent } : null]}>
            <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 12, color: m === metric ? color.accentFg : color.inkSoft }}>{labels[m]}</Text>
          </Pressable>
        ))}
      </View>
      {points.length >= 2 ? <PointsChart title={labels[metric]} points={points} unit={unit} /> : <T kind="faint">{d.notEnoughForChart}</T>}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  image: { width: "100%", aspectRatio: 4 / 3, borderRadius: 20 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  video: { height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  step: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1 },
  seg: { flexDirection: "row", borderRadius: 999, padding: 4, gap: 4 },
  segItem: { flex: 1, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
});
