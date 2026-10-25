import type { NotificationV1 } from "@healthapp/api/v1";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { nativeRoute } from "@/lib/web-route";
import { useI18n } from "@/lib/i18n";
import { enablePush, routeFor, type PushState } from "@/lib/push";
import { alpha, font, useTheme } from "@/lib/theme";

// The notifications center — the web's /notifications on a phone
// (components/notification-list.tsx): All | Unread, the unread count and
// "mark all as read", then the rows grouped into today, this week and earlier.
// Tapping one reads it and opens what it is about (a native screen when there
// is one, else the web). The card on top is where push is switched on, in
// context, never at launch.

const BELL = "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0";

/** Today / this week / earlier, by the reader's own calendar day (notification-list.tsx groupOf). */
function groupOf(iso: string, now: number): "today" | "week" | "earlier" {
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA");
  const at = Date.parse(iso);
  if (day(at) === day(now)) return "today";
  return now - at < 7 * 86_400_000 ? "week" : "earlier";
}

export default function NotificationsScreen() {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const [push, setPush] = useState<PushState | "unknown">("unknown");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [now] = useState(() => Date.now());
  const n = t.common.notifications;
  const s = t.common.social;

  useEffect(() => {
    if (Platform.OS === "web") return setPush("unavailable");
    void Notifications.getPermissionsAsync().then((p) => setPush(p.granted ? "granted" : "denied")).catch(() => setPush("unavailable"));
  }, []);

  const query = useInfiniteQuery({
    queryKey: ["notifications"],
    queryFn: ({ pageParam }) => api.notifications(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
  const all = query.data?.pages.flatMap((p) => p.items) ?? [];
  const items = unreadOnly ? all.filter((x) => !x.read) : all;
  const unread = all.filter((x) => !x.read).length;
  const when = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  async function open(row: NotificationV1) {
    if (!row.read) void api.markNotificationRead(row.id).then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] })).catch(() => {});
    // The exact screen the web's link names (a workout, a post, a thread), when the app has it;
    // else the screen for the category; else the page on voinic.fit.
    const exact = nativeRoute(row.href);
    if (exact) return void router.push(exact as never);
    const conversation = /\/messages\/([0-9a-f-]{36})/i.exec(row.href ?? "")?.[1];
    const native = routeFor({ category: row.category, conversation_id: conversation });
    if (native !== "/notifications") router.push(native);
    else if (row.href) void Linking.openURL(`${config.webUrl}${row.href}`);
  }

  const groups = (["today", "week", "earlier"] as const)
    .map((key) => ({ key, label: key === "today" ? n.groupToday : key === "week" ? n.groupWeek : n.groupEarlier, rows: items.filter((x) => groupOf(x.created_at, now) === key) }))
    .filter((g) => g.rows.length > 0);

  const pill = (active: boolean, label: string, onPress: () => void) => (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.pill, { backgroundColor: active ? color.accent : color.surface }]}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: active ? color.accentFg : color.inkSoft }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body}>
        <BackHeader label={t.mobile.tabs.more} />
        <T kind="title">{s.notifications}</T>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {pill(!unreadOnly, n.filterAll, () => setUnreadOnly(false))}
          {pill(unreadOnly, unread > 0 ? `${n.filterUnread}  ${unread}` : n.filterUnread, () => setUnreadOnly(true))}
        </View>

        {push === "denied" ? (
          <Card style={{ gap: 10 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.ink }}>{t.mobile.notifications.turnOn}</Text>
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

        {query.isLoading ? <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} /> : null}
        {query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : null}

        {query.isSuccess && items.length === 0 ? (
          <Card style={{ alignItems: "center", paddingVertical: 40 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink, textAlign: "center" }}>{unreadOnly ? n.noUnread : s.noNotifications}</Text>
            {unreadOnly ? null : <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13, color: color.inkSoft, textAlign: "center" }}>{s.noNotificationsHint}</Text>}
          </Card>
        ) : null}

        {all.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{unread > 0 ? fill(n.unreadCount, { count: unread }) : s.allRead}</Text>
            {unread > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void api.markNotificationRead().then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }))}
                style={[styles.pill, { backgroundColor: color.surface }]}
              >
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{s.markAllRead}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {groups.map((g) => (
          <View key={g.key} style={{ gap: 8 }}>
            <Text style={[styles.label(color.inkFaint), { paddingHorizontal: 4 }]}>{g.label}</Text>
            <View style={{ borderRadius: 24, overflow: "hidden", backgroundColor: color.surface }}>
              {g.rows.map((row, i) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  onPress={() => void open(row)}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 ? { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.5) } : null,
                    !row.read ? { backgroundColor: alpha(color.accentSoft, 0.4) } : null,
                    pressed ? { backgroundColor: alpha(color.bg, 0.6) } : null,
                  ]}
                >
                  <View style={[styles.icon, { backgroundColor: color.bg }]}>
                    <NavIcon d={BELL} size={17} color={color.inkFaint} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: row.read ? font.medium : font.semibold, fontSize: 13.5, lineHeight: 19, color: color.ink }}>{row.headline}</Text>
                    {row.body ? <Text numberOfLines={2} style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkSoft }}>{row.body}</Text> : null}
                    <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{when.format(new Date(row.created_at))}</Text>
                  </View>
                  {!row.read ? <View accessibilityLabel={s.unread} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.accent }} /> : null}
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {query.hasNextPage ? (
          <Pressable
            accessibilityRole="button"
            disabled={query.isFetchingNextPage}
            onPress={() => void query.fetchNextPage()}
            style={[styles.pill, { alignSelf: "center", backgroundColor: color.surface, opacity: query.isFetchingNextPage ? 0.5 : 1 }]}
          >
            <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{n.loadOlder}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = {
  ...StyleSheet.create({
    body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
    pill: { height: 36, flexDirection: "row", alignItems: "center", borderRadius: 18, paddingHorizontal: 14 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
    icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  }),
  label: (ink: string) => ({ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
};
