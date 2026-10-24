import type { CoachClientV1 } from "@healthapp/api/v1";
import { router } from "expo-router";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, NavIcon, T } from "@/components/ui";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { percent, timeAgo } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { alpha, font, useTheme } from "@/lib/theme";

// The coach's morning screen — the web's /dashboard on a phone (app/(coach)/
// dashboard/page.tsx): four figures, each opening the section it counts, then
// the queue of clients, at risk first, with why each one is flagged. The
// signal, the reason, the % and the at-risk count are Coach Pro, as on the web.
// A client opens on the web (the full client page); a check-in opens its review.

const ICON = {
  clients: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M18 20h4a6 6 0 0 0-3-5.2",
  checkIns: "M9 4h6v3H9zM9 5.5H6V20h12V5.5h-3M8.5 13l2.5 2.5 4.5-4.5",
  messages: "M4 5h16v11H9l-5 4z",
  risk: "M12 3.5 2.5 20.5h19zM12 10v4M12 17v.01",
  person: "M12 4a4 4 0 1 0 0 8 4 4 0 1 0 0-8M4 21a8 8 0 0 1 16 0",
} as const;

export default function Dashboard() {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const query = useOfflineQuery("coach-dashboard", ["coach-dashboard"], api.coachDashboard);
  const data = query.data?.data;
  const d = t.coachApp.dashboard;
  const pro = data?.pro ?? true;
  const rows = data?.clients ?? [];
  const atRisk = rows.filter((r) => r.signal === "at_risk").length;
  const unread = rows.reduce((sum, r) => sum + r.unread, 0);

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <T kind="title">{d.title}</T>
        {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}

        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            {data.requests_pending > 0 ? (
              <Pressable accessibilityRole="button" onPress={() => router.navigate("/inbox")}>
                <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{`${t.mobile.coach.requestsTitle} · ${data.requests_pending}`}</Text>
                  <NavIcon d="m9 6 6 6-6 6" size={16} color={color.accentInk} />
                </Card>
              </Pressable>
            ) : null}

            <View style={styles.grid}>
              <Stat icon={ICON.clients} label={d.activeClients} value={String(rows.length)} onPress={() => void Linking.openURL(`${config.webUrl}/clients`)} />
              <Stat icon={ICON.checkIns} label={d.checkInsToReview} value={String(data.checkins_pending)} accent={data.checkins_pending > 0} onPress={() => router.navigate("/inbox")} />
              <Stat icon={ICON.messages} label={d.unreadMessages} value={String(unread)} accent={unread > 0} onPress={() => router.navigate("/chats")} />
              <Stat icon={ICON.risk} label={d.atRisk} value={pro ? String(atRisk) : "—"} accent={pro && atRisk > 0} onPress={() => void Linking.openURL(`${config.webUrl}/clients`)} />
            </View>

            {rows.length === 0 ? (
              <View style={{ paddingVertical: 8 }}>
                <T kind="heading">{d.emptyTitle}</T>
                <T kind="faint" style={{ marginTop: 4, lineHeight: 18 }}>{d.emptyHint}</T>
              </View>
            ) : (
              <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
                {rows.map((r, i) => (
                  <ClientRow key={r.client_id} r={r} pro={pro} first={i === 0} locale={locale} />
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One headline figure on its own tile; the tile opens the section it counts. */
function Stat({ icon, label, value, accent = false, onPress }: { icon: string; label: string; value: string; accent?: boolean; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.stat, { backgroundColor: pressed ? alpha(color.accentSoft, 0.6) : color.surface }]}>
      <NavIcon d={icon} size={40} color={color.accentInk} />
      <Text numberOfLines={2} style={[styles.label(color.inkFaint), { minHeight: 30, textAlign: "center", textAlignVertical: "center" }]}>{label}</Text>
      <Text style={{ fontFamily: font.displayExtrabold, fontSize: 32, lineHeight: 34, color: accent ? color.accentInk : color.ink }}>{value}</Text>
    </Pressable>
  );
}

/** A queue row, stacked as the web's phone layout: who, the signal, why, then adherence, last log and the one action. */
function ClientRow({ r, pro, first, locale }: { r: CoachClientV1; pro: boolean; first: boolean; locale: "ro" | "en" }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const d = t.coachApp.dashboard;
  const tone = {
    on_track: { bg: color.accentSoft, ink: color.accentInk },
    needs_attention: { bg: color.warnSoft, ink: color.warn },
    at_risk: { bg: color.riskSoft, ink: color.risk },
  }[r.signal];
  // Only a real name gets a letter: an invitation placeholder starts with a bracket.
  const firstChar = [...r.name.trim()][0] ?? "";
  const initial = /\p{L}/u.test(firstChar) ? firstChar.toUpperCase() : null;
  const width = Math.round(Math.min(1, Math.max(0, r.overall)) * 100);
  const review = r.pending_checkin;

  return (
    <View style={[{ paddingHorizontal: 20, paddingVertical: 16 }, first ? null : { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) }]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={[styles.avatar, { backgroundColor: color.accentSoft }]}>
            {initial ? (
              <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentInk }}>{initial}</Text>
            ) : (
              <NavIcon d={ICON.person} size={17} color={color.accentInk} />
            )}
          </View>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold, fontSize: 15, color: color.ink }}>{r.name}</Text>
        </View>
        {pro ? (
          <View style={{ borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: tone.bg }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12, color: tone.ink }}>{t.common.signal[r.signal]}</Text>
          </View>
        ) : null}
      </View>
      {pro ? <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13, lineHeight: 20, color: color.inkSoft }}>{r.why}</Text> : null}
      <View style={{ marginTop: 12, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        {pro ? (
          <View>
            <Text style={styles.label(color.inkFaint)}>{d.thAdherence}</Text>
            <View style={{ marginTop: 4, width: 80, alignItems: "flex-end", gap: 6 }}>
              <Text style={{ fontFamily: font.displayExtrabold, fontSize: 17, color: color.ink }}>{percent(r.overall)}</Text>
              <View style={{ height: 4, width: "100%", borderRadius: 999, overflow: "hidden", backgroundColor: color.bg }}>
                <View style={{ height: "100%", width: `${width}%`, borderRadius: 999, backgroundColor: color.accent }} />
              </View>
            </View>
          </View>
        ) : null}
        <View>
          <Text style={styles.label(color.inkFaint)}>{d.thLastLog}</Text>
          <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{timeAgo(r.last_activity, locale)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => (review ? router.navigate("/inbox") : void Linking.openURL(`${config.webUrl}/clients?focus=${r.client_id}`))}
          style={({ pressed }) => [styles.action, { backgroundColor: color.bg, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{review ? d.review : d.open}</Text>
          <NavIcon d="m9 6 6 6-6 6" size={14} color={color.accentInk} strokeWidth={2.2} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = {
  ...StyleSheet.create({
    // 110 at the bottom: clear of the floating tab bar.
    body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 18 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    stat: { flexBasis: "46%", flexGrow: 1, alignItems: "center", gap: 10, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 20 },
    avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    action: { height: 44, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 22, paddingHorizontal: 16 },
  }),
  label: (ink: string) => ({ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
};
