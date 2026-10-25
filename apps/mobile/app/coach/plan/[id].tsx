import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PlanEditor } from "@/components/plan-editor";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// One of the coach's nutrition plans — the web's /nutrition/[id] on a phone;
// the editor itself is components/plan-editor.tsx (also the person's own meal plan).

export default function CoachPlan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { color } = useTheme();
  const query = useQuery({ queryKey: ["coach-nutrition", id], queryFn: () => api.coachPlan(id) });
  const plan = query.data;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.coachApp.nutrition.back} />
        {!plan ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <PlanEditor plan={plan} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 64, gap: 14 },
});
