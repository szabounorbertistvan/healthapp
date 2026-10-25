import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { T } from "@/components/ui";
import { WeeklyCard } from "@/components/weekly-card";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// The weekly report — Today's weekly summary on the web: this week (or the
// last) against the one before, on your own calendar.

export default function Weekly() {
  const { t } = useI18n();
  const { color } = useTheme();
  const [week, setWeek] = useState<"current" | "previous">("current");
  const query = useQuery({ queryKey: ["weekly", week], queryFn: () => api.weekly(week), placeholderData: (p) => p });
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.today} />
        <T kind="title">{t.clientApp.today.weeklyReport}</T>
        {query.data ? (
          <WeeklyCard summary={query.data} onSwitch={setWeek} />
        ) : query.isError || query.data === null ? (
          <T kind="soft">{query.data === null ? t.common.weekly.noData : t.mobile.errors.offline}</T>
        ) : (
          <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
});
