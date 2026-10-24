import type { NotificationV1 } from "@healthapp/api/v1";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Screen, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { enablePush, routeFor, type PushState } from "@/lib/push";
import { minTouchTarget, radius, space, useTheme } from "@/lib/theme";

// The notifications center — the web's /notifications: every row, headline in
// the reader's language, unread first to the eye. Tapping one reads it and
// opens what it is about (a native screen when there is one, else the web).
// The card on top is where push is switched on, in context, never at launch.
export default function NotificationsScreen() {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const [push, setPush] = useState<PushState | "unknown">("unknown");

  useEffect(() => {
    void Notifications.getPermissionsAsync().then((p) => setPush(p.granted ? "granted" : "denied")).catch(() => setPush("unavailable"));
  }, []);

  const query = useInfiniteQuery({
    queryKey: ["notifications"],
    queryFn: ({ pageParam }) => api.notifications(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  async function open(n: NotificationV1) {
    if (!n.read) void api.markNotificationRead(n.id).then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] })).catch(() => {});
    // The web's link names the conversation (/messages/<id>), which opens that exact thread.
    const conversation = /\/messages\/([0-9a-f-]{36})/i.exec(n.href ?? "")?.[1];
    const native = routeFor({ category: n.category, conversation_id: conversation });
    if (native !== "/notifications") router.push(native);
    else if (n.href) void Linking.openURL(`${config.webUrl}${n.href}`);
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.body}
          ListHeaderComponent={
            <View style={{ gap: space.md }}>
              <BackHeader label={t.mobile.tabs.more} />
              <T kind="title">{t.mobile.notifications.title}</T>
              {push === "denied" ? (
                <Card>
                  <T kind="heading">{t.mobile.notifications.turnOn}</T>
                  <T kind="soft">{t.mobile.notifications.turnOnHint}</T>
                  <Button
                    label={t.mobile.notifications.turnOn}
                    onPress={() =>
                      void enablePush(true).then(async (state) => {
                        setPush(state);
                        if (state === "denied") await Linking.openSettings();
                      })
                    }
                  />
                </Card>
              ) : null}
              {items.some((n) => !n.read) ? (
                <Button
                  kind="quiet"
                  label={t.mobile.notifications.markAll}
                  onPress={() => void api.markNotificationRead().then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }))}
                />
              ) : null}
              {query.isLoading ? <ActivityIndicator color={color.accent} /> : null}
              {query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : null}
            </View>
          }
          ListEmptyComponent={query.isSuccess ? <T kind="soft">{t.mobile.notifications.empty}</T> : undefined}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => void open(item)}
              style={[styles.row, { borderColor: color.line, backgroundColor: item.read ? color.bg : color.accentSoft }]}
            >
              <View style={[styles.dot, { backgroundColor: item.read ? "transparent" : color.accent }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <T style={{ fontWeight: item.read ? "400" : "700" }}>{item.headline}</T>
                {item.body ? <T kind="soft">{item.body}</T> : null}
                <T kind="faint">{new Date(item.created_at).toLocaleString()}</T>
              </View>
            </Pressable>
          )}
          ListFooterComponent={
            query.hasNextPage ? (
              <Button kind="quiet" label={t.mobile.notifications.loadOlder} busy={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} />
            ) : undefined
          }
        />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  row: { flexDirection: "row", gap: space.md, borderWidth: 1, borderRadius: radius.lg, padding: space.md, minHeight: minTouchTarget + 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
});
