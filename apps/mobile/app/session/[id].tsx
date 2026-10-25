import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SessionView } from "@/components/session-view";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/role";
import { font, useTheme } from "@/lib/theme";

// One of your finished workouts — the web's /workout/session/[id] on a phone:
// every set and what your coach wrote on it (a coach_feedback notice opens here).

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const unit = useMe().data?.data.weight_unit ?? "kg";
  const query = useQuery({ queryKey: ["session", id], queryFn: () => api.session(id) });
  const s = query.data;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.training} />
        {!s ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <T kind="title">{s.name ?? t.coachWidgets.workoutFeedback.freeWorkout}</T>
            <Text style={{ marginTop: -6, fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>
              {new Date(s.started_at).toLocaleString(locale === "ro" ? "ro-RO" : "en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
            </Text>
            <SessionView session={s} unit={unit} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
});
