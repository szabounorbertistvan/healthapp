import { router } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Screen, T } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { radius, space, useTheme } from "@/lib/theme";

// The coach's conversations, newest first — the web's /messages. A tap opens
// the shared ThreadView (app/thread/[id].tsx).
export default function Chats() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const query = useOfflineQuery("coach-conversations", ["coach-conversations"], api.coachConversations);
  const rows = query.data?.data;

  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
        >
          <T kind="title">{t.mobile.coach.chats}</T>
          {!rows ? (
            query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} />
          ) : rows.length === 0 ? (
            <T kind="soft">{t.mobile.coach.noChats}</T>
          ) : (
            rows.map((c) => (
              <Pressable key={c.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/thread/[id]", params: { id: c.id } })}>
                <Card style={c.unread > 0 ? { borderColor: color.accent } : undefined}>
                  <View style={styles.row}>
                    <T kind="heading" style={{ flex: 1 }}>{c.name}</T>
                    {c.unread > 0 ? (
                      <View style={[styles.count, { backgroundColor: color.accent }]}>
                        <T style={{ color: color.accentFg, fontWeight: "800" }}>{String(c.unread)}</T>
                      </View>
                    ) : null}
                  </View>
                  <T kind="soft" style={{ fontWeight: c.unread > 0 ? "700" : "400" }}>{c.last_message || "…"}</T>
                  <T kind="faint">
                    {new Date(c.last_at).toLocaleString()}
                    {c.unread > 0 ? ` · ${fill(t.mobile.coach.unread, { n: c.unread })}` : ""}
                    {c.open ? "" : ` · ${t.mobile.coach.closedThread}`}
                  </T>
                </Card>
              </Pressable>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  count: { minWidth: 26, height: 26, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
});
