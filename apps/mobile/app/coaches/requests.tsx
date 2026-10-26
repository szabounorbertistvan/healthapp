import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Primary } from "@/components/coach-profile-bits";
import { MyRequestCard } from "@/components/request-card";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The coaches the reader contacted — the web's /coaches/requests on a phone,
// pending first: cancel a pending one, message the coach once accepted, and
// what comes next once coaching started, paused or ended.

export default function MyRequests() {
  const { t } = useI18n();
  const { color } = useTheme();
  const m = t.coachProfile.requests.mine;
  const query = useQuery({ queryKey: ["my-requests"], queryFn: api.myRequests });
  const rows = query.data ?? [];
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.coachProfile.discovery.backToDiscover} />
        <View>
          <T kind="title">{m.title}</T>
          <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>{m.hint}</Text>
        </View>
        {!query.data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : rows.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: color.surface }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink, textAlign: "center" }}>{m.empty}</Text>
            <View style={{ marginTop: 16 }}><Primary label={m.emptyCta} onPress={() => router.push("/coaches")} /></View>
          </View>
        ) : (
          rows.map((q) => <MyRequestCard key={q.id} q={q} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  empty: { borderRadius: 24, paddingHorizontal: 24, paddingVertical: 36, alignItems: "center" },
});
