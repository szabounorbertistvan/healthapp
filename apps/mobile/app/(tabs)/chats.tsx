import { router } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { T } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { alpha, font, useTheme } from "@/lib/theme";

// The coach's conversations, newest first — the web's /messages list: who, the
// last line, when, and the unread count. A tap opens the shared ThreadView
// (app/thread/[id].tsx).
export default function Chats() {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const query = useOfflineQuery("coach-conversations", ["coach-conversations"], api.coachConversations);
  const rows = query.data?.data;
  const when = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <T kind="title">{t.common.nav.messages}</T>
        {!rows ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : rows.length === 0 ? (
          <T kind="faint">{t.mobile.coach.noChats}</T>
        ) : (
          <View style={{ borderRadius: 24, overflow: "hidden", backgroundColor: color.surface }}>
            {rows.map((c, i) => {
              const initial = [...c.name.trim()][0]?.toUpperCase() ?? "?";
              const unread = c.unread > 0;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: "/thread/[id]", params: { id: c.id } })}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 ? { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.5) } : null,
                    unread ? { backgroundColor: alpha(color.accentSoft, 0.4) } : null,
                    pressed ? { backgroundColor: alpha(color.bg, 0.6) } : null,
                  ]}
                >
                  <View style={[styles.avatar, { backgroundColor: color.accentSoft }]}>
                    <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentInk }}>{initial}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{c.name}</Text>
                      <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{when.format(new Date(c.last_at))}</Text>
                    </View>
                    <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: unread ? font.semibold : font.regular, fontSize: 13, color: unread ? color.ink : color.inkSoft }}>
                      {c.last_message || "…"}
                    </Text>
                    {!c.open ? <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{t.mobile.coach.closedThread}</Text> : null}
                  </View>
                  {unread ? (
                    <View accessibilityLabel={fill(t.mobile.coach.unread, { n: c.unread })} style={[styles.count, { backgroundColor: color.accent }]}>
                      <Text style={{ fontFamily: font.bold, fontSize: 12, color: color.accentFg }}>{c.unread}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // 110 at the bottom: clear of the floating tab bar.
  body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  count: { minWidth: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
});
