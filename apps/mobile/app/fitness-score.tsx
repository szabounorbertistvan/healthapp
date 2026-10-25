import type { FitnessScoreV1 } from "@healthapp/api/v1";
import { FITNESS_SCORE_MIN_WORKOUTS, FITNESS_SCORE_WEIGHTS, fitnessScoreMilestone, type FitnessScore } from "@healthapp/shared";
import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ShareToFeed } from "@/components/share-feed";
import { Bar, Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";
import { parseDay } from "@/lib/week";

// The fitness score — the web's /fitness-score on a phone (fitness-score.tsx
// FitnessScoreDetail): the number and its band, the trend against the 28 days
// before, each part with the count behind it and its weight, how it is put
// together, and Share to feed. The plan gates the trend and the breakdown.

type Key = keyof typeof FITNESS_SCORE_WEIGHTS;
const KEYS: readonly Key[] = ["trainingLoad", "consistency", "frequency", "volume"];
const sub = (s: FitnessScore, k: Key) =>
  k === "trainingLoad" ? s.trainingLoadScore : k === "consistency" ? s.consistencyScore : k === "frequency" ? s.frequencyScore : s.volumeScore;

export default function FitnessScoreScreen() {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const f = t.common.fitnessScore;
  const query = useQuery({ queryKey: ["fitness-score"], queryFn: api.fitnessScore });
  const v = query.data;
  const milestone = v?.current.score != null ? fitnessScoreMilestone(v.current.score) : null;
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" });
  const period = (p: { start: string; end: string }) => fill(f.periodLabel, { start: df.format(parseDay(p.start)), end: df.format(parseDay(p.end)) });
  const fact = (s: FitnessScore, k: Key) =>
    k === "trainingLoad" ? fill(f.facts.averageLoad, { value: Math.round(s.averageTrainingLoad) })
    : k === "consistency" ? (s.activeWorkoutDays === 1 ? f.facts.activeDayOne : fill(f.facts.activeDays, { count: s.activeWorkoutDays }))
    : k === "frequency" ? (s.completedWorkouts === 1 ? f.facts.workoutOne : fill(f.facts.workouts, { count: s.completedWorkouts }))
    : fill(f.facts.volume, { kg: nf.format(Math.round(s.totalVolume)) });

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.today} />
        <T kind="title">{f.title}</T>
        {!v ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <T kind="label">{f.title}</T>
                <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{`${f.last28Days} · ${period(v.current.period)}`}</Text>
              </View>
              {v.current.status === "building" ? (
                <View style={{ gap: 4 }}>
                  <Text style={{ fontFamily: font.displayExtrabold, fontSize: 28, color: color.ink }}>{f.building}</Text>
                  <T kind="soft" style={{ lineHeight: 19 }}>{f.buildingHint}</T>
                  <T kind="faint">{fill(f.buildingProgress, { done: v.current.completedWorkouts, needed: FITNESS_SCORE_MIN_WORKOUTS })}</T>
                </View>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
                  <Text style={{ fontFamily: font.displayExtrabold, fontSize: 56, color: color.ink }}>{String(v.current.score)}</Text>
                  <Text style={{ fontFamily: font.semibold, fontSize: 16, color: v.current.band === "developing" || v.current.band === "strong_activity" ? color.accentInk : color.inkSoft }}>
                    {v.current.band ? f.band[v.current.band] : f.building}
                  </Text>
                </View>
              )}
            </Card>

            {v.charts ? (
              <>
                <Card style={{ gap: 10 }}>
                  <T kind="label">{f.trendTitle}</T>
                  <View style={{ flexDirection: "row", gap: 16 }}>
                    <View style={{ flex: 1 }}>
                      <T kind="faint">{f.currentPeriod}</T>
                      <Text style={{ fontFamily: font.displayBold, fontSize: 24, color: color.ink }}>{v.current.score ?? "—"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <T kind="faint">{f.previousPeriod}</T>
                      <Text style={{ fontFamily: font.displayBold, fontSize: 24, color: color.inkSoft }}>{v.previous.score ?? "—"}</Text>
                      <T kind="faint">{period(v.previous.period)}</T>
                    </View>
                  </View>
                  <Trend v={v} />
                </Card>
                <Card style={{ gap: 14 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <T kind="label">{f.weights}</T>
                    <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{f.last28Days}</Text>
                  </View>
                  {KEYS.map((k) => {
                    const value = sub(v.current, k);
                    return (
                      <View key={k} style={{ gap: 6 }}>
                        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                          <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>
                            {f.components[k]}
                            <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.inkFaint }}>{`  ${fill(f.weight, { pct: Math.round(FITNESS_SCORE_WEIGHTS[k] * 100) })}`}</Text>
                          </Text>
                          <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{String(Math.round(value))}</Text>
                        </View>
                        <Bar ratio={value / 100} height={6} />
                        <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{fact(v.current, k)}</Text>
                      </View>
                    );
                  })}
                </Card>
              </>
            ) : null}

            <Card style={{ gap: 8 }}>
              <T kind="label">{f.howTitle}</T>
              <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.inkSoft }}>{f.howIntro}</Text>
              {KEYS.map((k) => (
                <View key={k} style={{ gap: 2 }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>
                    {f.components[k]}
                    <Text style={{ fontSize: 11, color: color.inkFaint }}>{`  ${fill(f.weight, { pct: Math.round(FITNESS_SCORE_WEIGHTS[k] * 100) })}`}</Text>
                  </Text>
                  <Text style={{ fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkSoft }}>{f.how[k]}</Text>
                </View>
              ))}
            </Card>

            {v.current.status === "active" ? (
              <Card style={{ gap: 8 }}>
                <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.ink }}>{t.common.social.shareScoreTitle}</Text>
                {milestone === null ? (
                  <T kind="soft" style={{ lineHeight: 19 }}>{t.common.social.shareScoreBelow}</T>
                ) : (
                  <>
                    <T kind="soft" style={{ lineHeight: 19 }}>{fill(t.common.social.shareScoreBody, { milestone })}</T>
                    <ShareToFeed label={t.common.social.shareScoreCta} share={(visibility) => api.shareFitnessScore(visibility)} />
                  </>
                )}
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Trend({ v }: { v: FitnessScoreV1 }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const f = t.common.fitnessScore;
  if (v.trend.delta === null) return <T kind="faint">{f.trendNoPrevious}</T>;
  const tone = v.trend.direction === "up" ? color.accentInk : v.trend.direction === "down" ? color.warn : color.inkSoft;
  return (
    <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
      <Text style={{ fontFamily: font.semibold, color: tone }}>{v.trend.direction === "stable" ? f.trendNoChange : v.trend.delta > 0 ? `+${v.trend.delta}` : String(v.trend.delta)}</Text>
      {` ${f.trendVsPrevious}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
});
