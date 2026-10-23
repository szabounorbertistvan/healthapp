import type { TodayV1 } from "@healthapp/api/v1";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Screen, T } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { radius, space, useTheme } from "@/lib/theme";

// Today: the same numbers as the web's /today (GET /api/v1/today runs getToday()).
export default function Today() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const query = useQuery({ queryKey: ["today"], queryFn: api.today });
  const refused = query.error instanceof ApiFailure && query.error.kind === "unauthorized";

  useEffect(() => {
    // The token was refused (revoked, account removed): back to sign-in.
    if (refused) signOut().catch(() => {});
  }, [refused]);

  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />
          }
        >
          {query.data ? (
            <TodayCards today={query.data} />
          ) : query.isError ? (
            <Card>
              <T kind="heading">{t.mobile.today.loadFailed}</T>
              <T kind="soft">
                {query.error instanceof ApiFailure && query.error.kind === "offline"
                  ? t.mobile.errors.offline
                  : t.mobile.errors.generic}
              </T>
              <Button kind="quiet" label={t.mobile.today.retry} onPress={() => query.refetch()} />
            </Card>
          ) : (
            <ActivityIndicator color={color.accent} style={{ marginTop: space.xxl }} />
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );

  function TodayCards({ today }: { today: TodayV1 }) {
    const signalColor = { on_track: color.accent, needs_attention: color.warn, at_risk: color.risk }[today.adherence.signal];
    const next = today.next_workout;
    const habitsDone = today.habits.filter((h) => h.done_today).length;
    const kcalTarget = Math.round(today.nutrition.target.kcal);
    return (
      <>
        <T kind="title">{fill(t.mobile.today.hi, { name: today.display_name })}</T>

        <Card>
          <T kind="faint">{t.mobile.today.week}</T>
          <View style={styles.row}>
            <T kind="title">{Math.round(today.adherence.overall)}%</T>
            <View style={[styles.pill, { backgroundColor: signalColor }]}>
              <T style={{ color: color.accentFg, fontWeight: "700" }}>{t.mobile.today.signal[today.adherence.signal]}</T>
            </View>
          </View>
          <View style={styles.row}>
            <Stat label={t.mobile.today.streak} value={today.streak_days === 1 ? t.mobile.today.day : fill(t.mobile.today.days, { n: today.streak_days })} />
            <Stat label={t.mobile.today.sessions} value={fill(t.mobile.today.sessionsOf, { done: today.sessions.done, planned: today.sessions.planned })} />
          </View>
        </Card>

        <Card>
          <T kind="faint">{t.mobile.today.nextWorkout}</T>
          {next ? (
            <>
              <T kind="heading">{next.day_name}</T>
              <T kind="soft">{`${next.program_name} · ${fill(t.mobile.today.exercises, { n: next.exercise_count })}`}</T>
              <Button
                label={t.clientApp.workoutDay.start}
                onPress={() => router.push({ pathname: "/workout/[dayId]", params: { dayId: next.day_id } })}
              />
            </>
          ) : today.sessions.planned > 0 ? (
            <T kind="soft">{t.mobile.today.allDone}</T>
          ) : (
            <T kind="soft">{today.has_coach ? t.mobile.today.noProgram : t.mobile.today.noProgramSolo}</T>
          )}
        </Card>

        <Card>
          <T kind="faint">{t.mobile.today.nutrition}</T>
          {kcalTarget > 0 ? (
            <>
              <T kind="heading">{fill(t.mobile.today.kcalOf, { eaten: Math.round(today.nutrition.totals.kcal), target: kcalTarget })}</T>
              <Progress value={today.nutrition.totals.kcal / kcalTarget} />
              <T kind="soft">
                {fill(t.mobile.today.protein, {
                  eaten: Math.round(today.nutrition.totals.protein),
                  target: Math.round(today.nutrition.target.protein),
                })}
              </T>
            </>
          ) : (
            <T kind="soft">{t.mobile.today.noTarget}</T>
          )}
        </Card>

        <Card>
          <T kind="faint">{t.mobile.today.habits}</T>
          {today.habits.length > 0 ? (
            <>
              <T kind="heading">{fill(t.mobile.today.habitsDone, { done: habitsDone, total: today.habits.length })}</T>
              {today.habits.map((h) => (
                <T key={h.id} kind={h.done_today ? "body" : "soft"}>{`${h.done_today ? "✓" : "○"}  ${h.name}`}</T>
              ))}
            </>
          ) : (
            <T kind="soft">{t.mobile.today.noHabits}</T>
          )}
          <Button kind="quiet" label={t.mobile.habits.title} onPress={() => router.push("/habits")} />
        </Card>

        <Card>
          <T kind="faint">{t.mobile.today.checkIn}</T>
          <T kind="soft">{today.check_in.submitted ? t.mobile.today.checkInDone : t.mobile.today.checkInDue}</T>
          {today.check_in.submitted ? null : <Button kind="quiet" label={t.mobile.progress.open} onPress={() => router.push("/check-in")} />}
        </Card>
      </>
    );
  }

  function Stat({ label, value }: { label: string; value: string }) {
    return (
      <View style={{ flex: 1, gap: 2 }}>
        <T kind="faint">{label}</T>
        <T kind="heading">{value}</T>
      </View>
    );
  }

  function Progress({ value }: { value: number }) {
    const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    return (
      <View style={[styles.track, { backgroundColor: color.line }]}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: color.accent }]} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  pill: { borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  track: { height: 8, borderRadius: radius.pill, overflow: "hidden" },
  fill: { height: 8, borderRadius: radius.pill },
});
