import type { CoachBookingsV1 } from "@healthapp/api/v1";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The coach's bookings — the web's /bookings on a phone (components/bookings.tsx
// CoachBookingList): a tab at a time, each booking with who, what, when in its
// own zone, and the moves it allows (confirm, decline or cancel with a reason,
// completed, no-show). Hours and time off are /coach/availability.

type Tab = CoachBookingsV1["tab"];
type Row = CoachBookingsV1["items"][number];
const TABS: Tab[] = ["upcoming", "pending", "confirmed", "past", "completed", "cancelled"];

export default function CoachBookings() {
  const { t } = useI18n();
  const { color } = useTheme();
  const b = t.coachProfile.bookings;
  const [tab, setTab] = useState<Tab>("upcoming");
  const query = useQuery({ queryKey: ["coach-bookings", tab], queryFn: () => api.coachBookings(tab), placeholderData: (p) => p });
  const rows = query.data?.items ?? [];
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.marketplace.title} />
        <View>
          <T kind="title">{b.title}</T>
          <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>{b.hint}</Text>
          <Text accessibilityRole="link" onPress={() => router.push("/coach/availability")} style={{ marginTop: 6, fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{`${b.availabilityLink} →`}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {TABS.map((k) => (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: k === tab }} onPress={() => setTab(k)} style={[styles.tab, { backgroundColor: k === tab ? color.accent : color.surface }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: k === tab ? color.accentFg : color.inkSoft }}>{b.tabs[k]}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {!query.data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : rows.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: color.surface }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink, textAlign: "center" }}>{b.empty}</Text>
            <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft, textAlign: "center" }}>{b.emptyHint}</Text>
          </View>
        ) : (
          rows.map((row) => <BookingCard key={row.id} row={row} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BookingCard({ row }: { row: Row }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const b = t.coachProfile.bookings;
  const [asking, setAsking] = useState<"decline" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tone = row.status === "pending" ? { bg: color.warnSoft, ink: color.warn } : row.status === "confirmed" ? { bg: color.accentSoft, ink: color.accentInk } : row.status === "no_show" ? { bg: color.riskSoft, ink: color.risk } : { bg: color.bg, ink: color.inkFaint };

  async function move(m: Row["moves"][number]) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.coachBookingMove(row.id, m, reason.trim() || null);
      if (!r.ok) {
        const code = r.errorCode as keyof typeof b.errors | undefined;
        setError((code && code in b.errors ? b.errors[code] : null) ?? b.errors.generic);
      }
      setAsking(null);
      await queryClient.invalidateQueries({ queryKey: ["coach-bookings"] });
      void queryClient.invalidateQueries({ queryKey: ["coach-marketplace"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : b.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: color.surface }]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        {row.person_avatar ? <Image source={{ uri: row.person_avatar }} style={styles.avatar} /> : (
          <View style={[styles.avatar, { backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.accentInk }}>{[...row.person_name.trim()][0]?.toUpperCase() ?? "?"}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{row.person_name}</Text>
          <Text numberOfLines={1} style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{`${row.service_name}${row.price ? ` · ${row.price}` : ""}`}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: tone.bg }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: tone.ink }}>{b.statuses[row.status]}</Text>
        </View>
      </View>
      <Text style={{ marginTop: 12, fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>
        {`${row.date} · ${row.time}`}
        <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{`  ${fill(b.zone, { zone: row.zone })}`}</Text>
      </Text>
      {row.note ? <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft }}>{fill(b.note, { note: row.note })}</Text> : null}
      {row.status === "cancelled" ? (
        <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
          {`${row.cancelled_by_me ? b.cancelledByYou : fill(b.cancelledByOther, { name: row.person_name })}${row.cancellation_reason ? ` · ${fill(b.reason, { reason: row.cancellation_reason })}` : ""}`}
        </Text>
      ) : null}

      {asking ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          <TextInput autoFocus value={reason} onChangeText={setReason} maxLength={500} placeholder={b.reasonPrompt} placeholderTextColor={color.inkFaint} accessibilityLabel={b.reasonPrompt} style={[styles.input, { color: color.ink, backgroundColor: color.bg }]} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void move(asking)} style={[styles.button, { backgroundColor: color.accent, opacity: busy ? 0.5 : 1 }]}>
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: color.accentFg }}>{b.moves[asking]}</Text>
            </Pressable>
            <Text accessibilityRole="button" onPress={() => setAsking(null)} style={{ fontFamily: font.semibold, fontSize: 15, color: color.inkFaint }}>✕</Text>
          </View>
        </View>
      ) : row.moves.length > 0 || row.conversation_id ? (
        <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {row.moves.map((m, i) => (
            <Pressable
              key={m}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => (m === "decline" || m === "cancel" ? (setReason(""), setAsking(m)) : void move(m))}
              style={[styles.button, { backgroundColor: i === 0 && m !== "decline" && m !== "cancel" ? color.accent : color.bg, opacity: busy ? 0.5 : 1 }]}
            >
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: i === 0 && m !== "decline" && m !== "cancel" ? color.accentFg : color.inkSoft }}>{b.moves[m]}</Text>
            </Pressable>
          ))}
          {row.conversation_id ? (
            <Text accessibilityRole="link" onPress={() => router.push({ pathname: "/thread/[id]", params: { id: row.conversation_id! } })} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{b.message}</Text>
          ) : null}
        </View>
      ) : null}
      {error ? <Text style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  tab: { height: 38, borderRadius: 19, paddingHorizontal: 14, justifyContent: "center" },
  empty: { borderRadius: 24, paddingHorizontal: 24, paddingVertical: 36 },
  card: { borderRadius: 24, padding: 16 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  input: { height: 42, borderRadius: 12, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 13.5 },
  button: { height: 40, borderRadius: 12, paddingHorizontal: 14, justifyContent: "center" },
});
