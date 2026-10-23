import { Link } from "expo-router";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Screen, T } from "@/components/ui";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { radius, space, useTheme } from "@/lib/theme";

// The Workout tab: every published program, as the web's /workout lists them.
export default function Workout() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const query = useOfflineQuery("workouts", ["workouts"], api.workouts);
  const data = query.data?.data;

  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
        >
          <T kind="title">{t.mobile.tabs.workout}</T>
          {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}

          {!data ? (
            query.isError ? (
              <T kind="soft">{t.mobile.errors.offline}</T>
            ) : (
              <ActivityIndicator color={color.accent} style={{ marginTop: space.xxl }} />
            )
          ) : data.programs.length === 0 ? (
            <Card>
              <T kind="heading">{t.clientApp.workout.noProgramTitle}</T>
              <T kind="soft">{data.has_coach ? t.clientApp.workout.noProgramHint : t.clientApp.workout.noProgramHintSolo}</T>
            </Card>
          ) : (
            data.programs.map((program) => (
              <Card key={program.program_id}>
                <View style={styles.row}>
                  <T kind="heading" style={{ flex: 1 }}>{program.program_name}</T>
                  <T kind="faint">
                    {program.followed ? t.clientApp.workout.followed : program.is_own ? t.clientApp.workout.byYou : t.clientApp.workout.byCoach}
                  </T>
                </View>
                {program.days.map((day) => {
                  const next = day.day_id === data.next_day_id;
                  return (
                    <Link key={day.day_id} href={{ pathname: "/workout/[dayId]", params: { dayId: day.day_id } }} asChild>
                      <Pressable
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.day,
                          { borderColor: next ? color.accent : color.line, backgroundColor: pressed ? color.accentSoft : color.bg },
                        ]}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <T kind="body" style={{ fontWeight: "700" }}>{day.day_name}</T>
                          <T kind="faint">{fill(t.clientApp.workout.exercisesCount, { count: day.exercise_count })}</T>
                        </View>
                        {day.completed ? (
                          <T kind="accent">✓</T>
                        ) : day.in_progress ? (
                          <T kind="accent">{t.clientApp.workout.inProgress}</T>
                        ) : next ? (
                          <T kind="accent">{t.clientApp.workout.nextUp}</T>
                        ) : null}
                      </Pressable>
                    </Link>
                  );
                })}
              </Card>
            ))
          )}

          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${config.webUrl}/workout`)}>
            <T kind="accent" style={{ textAlign: "center", marginTop: space.md }}>{t.mobile.workout.openOnWeb}</T>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  day: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    minHeight: 56,
  },
});
