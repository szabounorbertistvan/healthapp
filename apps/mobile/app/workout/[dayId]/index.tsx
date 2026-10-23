import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Screen, T } from "@/components/ui";
import { BackHeader, prescription, Previous } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { setsByExercise } from "@/lib/logger-model";
import { useOfflineQuery } from "@/lib/offline-query";
import { queuedForDay } from "@/lib/outbox-core";
import { useOutbox } from "@/lib/outbox";
import { space, useTheme } from "@/lib/theme";

// A training day before it starts: what is prescribed and what was done last
// time — the web's /workout/[dayId]. Opening it also keeps the day on the phone,
// so the logger behind it works with no signal.
export default function WorkoutDayScreen() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const { t } = useI18n();
  const { color } = useTheme();
  const { session } = useAuth();
  const outbox = useOutbox();
  const query = useOfflineQuery(`day:${dayId}`, ["workout", dayId], () => api.workoutDay(dayId));
  const day = query.data?.data;

  const waiting = day && session ? queuedForDay(outbox.items, session.user.id, day.day_id) : [];
  const sets = day ? setsByExercise(day, waiting) : {};
  const started = Object.values(sets).some((list) => list.length > 0);

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body}>
          <BackHeader label={t.clientApp.workoutDay.backToTraining} />
          {!day ? (
            query.isError ? (
              <T kind="soft">{t.mobile.workout.needsDayFirst}</T>
            ) : (
              <ActivityIndicator color={color.accent} style={{ marginTop: space.xxl }} />
            )
          ) : (
            <>
              <T kind="faint">{day.program_name.toUpperCase()}</T>
              <T kind="title">{day.day_name}</T>
              {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}
              <Button
                label={day.completed ? t.clientApp.workoutDay.addSets : started ? t.clientApp.workoutDay.continueWorkout : t.clientApp.workoutDay.start}
                onPress={() => router.push({ pathname: "/workout/[dayId]/log", params: { dayId: day.day_id } })}
              />
              <T kind="heading" style={{ marginTop: space.md }}>{t.clientApp.workoutDay.exercises}</T>
              {day.exercises.map((e) => (
                <Card key={e.id}>
                  <T kind="heading">{e.name}</T>
                  <T kind="soft">{prescription(e, day.intensity_mode, t)}</T>
                  {e.notes ? <T kind="faint">{`${t.clientWidgets.setLogger.coachNote}: ${e.notes}`}</T> : null}
                  <Previous e={e} day={day} t={t} />
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl } });
