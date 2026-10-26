import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CoachRequestCard } from "@/components/request-card";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The coach's contact requests — the web's /requests on a phone: a tab at a
// time (pending first), each request with the moves its state allows.
// "Coaching" = accepted and started; "Accepted" = accepted, not started yet.

const TABS = ["pending", "accepted", "coaching", "declined", "cancelled", "all"] as const;
type Tab = (typeof TABS)[number];

export default function CoachRequests() {
  const { t } = useI18n();
  const { color } = useTheme();
  const r = t.coachProfile.requests;
  const [tab, setTab] = useState<Tab>("pending");
  const query = useQuery({ queryKey: ["coach-request-list", tab], queryFn: () => api.coachRequestList(tab), placeholderData: (p) => p });
  const rows = query.data ?? [];
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.marketplace.title} />
        <View>
          <T kind="title">{r.title}</T>
          <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>{r.hint}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {TABS.map((k) => (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: k === tab }} onPress={() => setTab(k)} style={[styles.tab, { backgroundColor: k === tab ? color.accent : color.surface }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: k === tab ? color.accentFg : color.inkSoft }}>{r.tabs[k]}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {!query.data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : rows.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: color.surface }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{r.empty}</Text>
            <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>{r.emptyHint}</Text>
          </View>
        ) : (
          rows.map((q) => <CoachRequestCard key={q.id} q={q} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  tab: { height: 38, borderRadius: 19, paddingHorizontal: 14, justifyContent: "center" },
  empty: { borderRadius: 24, padding: 20 },
});
