import type { CoachClientV1 } from "@healthapp/api/v1";
import { router } from "expo-router";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Screen, T } from "@/components/ui";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { percent } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { minTouchTarget, radius, space, useTheme } from "@/lib/theme";

// The coach's priority list — the web's /dashboard on the phone: at risk
// first, each client with the live signal, the week's %, and the same "why".
// A client opens on the web (the full client page); the chat icon opens the thread.
export default function Clients() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const query = useOfflineQuery("coach-dashboard", ["coach-dashboard"], api.coachDashboard);
  const chats = useOfflineQuery("coach-conversations", ["coach-conversations"], api.coachConversations);
  const data = query.data?.data;
  const threadOf = (clientId: string) => chats.data?.data.find((c) => c.client_id === clientId)?.id ?? null;

  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => {
                void query.refetch();
                void chats.refetch();
              }}
              tintColor={color.accent}
            />
          }
        >
          <T kind="title">{t.mobile.coach.clients}</T>
          {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}
          {data && (data.checkins_pending > 0 || data.requests_pending > 0) ? (
            <Pressable accessibilityRole="button" onPress={() => router.push("/inbox")}>
              <Card style={{ borderColor: color.accent }}>
                <T kind="heading">{`${t.mobile.coach.inbox} · ${data.checkins_pending + data.requests_pending}`}</T>
                <T kind="soft">{`${t.mobile.coach.checkInsTitle}: ${data.checkins_pending} · ${t.mobile.coach.requestsTitle}: ${data.requests_pending}`}</T>
              </Card>
            </Pressable>
          ) : null}
          {!data ? (
            query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} />
          ) : data.clients.length === 0 ? (
            <Card>
              <T kind="soft">{t.mobile.coach.noClients}</T>
            </Card>
          ) : (
            data.clients.map((c) => <ClientRow key={c.client_id} c={c} threadId={threadOf(c.client_id)} />)
          )}
          <T kind="faint" style={{ textAlign: "center" }}>{t.mobile.coach.builders}</T>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );

  function ClientRow({ c, threadId }: { c: CoachClientV1; threadId: string | null }) {
    const tone = { on_track: color.accent, needs_attention: color.warn, at_risk: color.risk }[c.signal];
    return (
      <Card>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${config.webUrl}/clients/${c.client_id}`)} style={{ gap: space.xs }}>
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: tone }]} />
            <T kind="heading" style={{ flex: 1 }}>{c.name}</T>
            <T kind="heading">{percent(c.overall)}</T>
          </View>
          <T style={{ color: tone, fontWeight: "700" }}>{t.mobile.today.signal[c.signal]}</T>
          <T kind="soft">{c.why}</T>
          <T kind="faint">
            {c.last_activity ? fill(t.mobile.coach.lastActive, { date: new Date(c.last_activity).toLocaleDateString() }) : t.mobile.coach.neverActive}
          </T>
        </Pressable>
        <View style={styles.row}>
          {c.pending_checkin ? <Badge label={t.mobile.coach.pendingCheckIn} onPress={() => router.push("/inbox")} /> : null}
          {threadId ? (
            <Badge
              label={c.unread > 0 ? `${t.mobile.coach.message} · ${fill(t.mobile.coach.unread, { n: c.unread })}` : t.mobile.coach.message}
              onPress={() => router.push({ pathname: "/thread/[id]", params: { id: threadId } })}
            />
          ) : null}
        </View>
      </Card>
    );
  }

  function Badge({ label, onPress }: { label: string; onPress: () => void }) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={[styles.badge, { borderColor: color.line, backgroundColor: color.accentSoft }]}>
        <T style={{ fontWeight: "600" }}>{label}</T>
      </Pressable>
    );
  }
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  badge: { minHeight: minTouchTarget, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, justifyContent: "center" },
});
