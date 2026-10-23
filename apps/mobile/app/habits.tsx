import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Screen, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { pendingHabitState } from "@/lib/outbox-core";
import { useOutbox } from "@/lib/outbox";
import { minTouchTarget, radius, space, useTheme } from "@/lib/theme";

// The habits for today — a tap ticks or unticks one. The tick is a state, sent
// by the outbox through the web's setHabitDone(), so it works with no signal
// and a late second delivery changes nothing.
export default function Habits() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const { session } = useAuth();
  const outbox = useOutbox();
  const query = useOfflineQuery("habits", ["habits"], api.habits);
  const data = query.data?.data;
  const userId = session?.user.id ?? "";

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body}>
          <BackHeader label={t.mobile.tabs.today} />
          <T kind="title">{t.mobile.habits.title}</T>
          {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}
          {!data ? (
            query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} />
          ) : data.habits.length === 0 ? (
            <Card>
              <T kind="heading">{t.clientApp.habits.noHabitsTitle}</T>
              <T kind="soft">{t.clientApp.habits.noHabitsHint}</T>
            </Card>
          ) : (
            <Card>
              <T kind="faint">{t.mobile.habits.tapToTick}</T>
              {data.habits.map((h) => {
                const pending = pendingHabitState(outbox.items, userId, h.id, data.today);
                const done = pending ?? h.done_today;
                // The week's count follows the tick the phone is still sending.
                const week = h.done_this_week + (pending === undefined || pending === h.done_today ? 0 : pending ? 1 : -1);
                return (
                  <Pressable
                    key={h.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: done }}
                    onPress={() => void outbox.queue({ kind: "habit", input: { habitId: h.id, day: data.today, done: !done } })}
                    style={[styles.habit, { borderColor: done ? color.accent : color.line, backgroundColor: done ? color.accentSoft : color.bg }]}
                  >
                    <View style={[styles.box, { borderColor: done ? color.accent : color.inkFaint, backgroundColor: done ? color.accent : "transparent" }]}>
                      {done ? <T style={{ color: color.accentFg, fontWeight: "800" }}>✓</T> : null}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T style={{ fontWeight: "600" }}>{h.name}</T>
                      <T kind="faint">
                        {fill(t.clientApp.habits.thisWeek, { done: Math.max(0, week), target: h.target_per_week })}
                        {pending !== undefined ? ` · ${t.mobile.workout.waiting}` : ""}
                      </T>
                    </View>
                  </Pressable>
                );
              })}
            </Card>
          )}
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${config.webUrl}/habits`)}>
            <T kind="accent" style={{ textAlign: "center" }}>{t.mobile.habits.addOnWeb}</T>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  habit: { flexDirection: "row", alignItems: "center", gap: space.md, borderWidth: 1, borderRadius: radius.lg, padding: space.md, minHeight: minTouchTarget + 12 },
  box: { width: 28, height: 28, borderRadius: radius.md, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
