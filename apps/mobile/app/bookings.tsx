import type { BookingV1 } from "@healthapp/api/v1";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import type { ColorTokens } from "@healthapp/ui-tokens";
import { font, useTheme } from "@/lib/theme";

// My bookings — the web's /coaches/bookings on a phone (components/bookings.tsx
// MyBookingList): upcoming, waiting for the coach, past, cancelled; each with
// who, what, when in the booking's own zone, and Cancel while bookingMoves()
// allows it. Booking a new session stays on the coach's public page.

type Section = "upcoming" | "pending" | "past" | "cancelled";

export default function Bookings() {
  const { t } = useI18n();
  const { color } = useTheme();
  const b = t.bookings;
  const m = b.mine;
  const query = useQuery({ queryKey: ["bookings"], queryFn: api.bookings });
  const rows = query.data?.items ?? [];
  const now = Date.now();
  const future = (r: BookingV1) => new Date(r.start_at).getTime() > now;
  const latest = (a: BookingV1, z: BookingV1) => z.start_at.localeCompare(a.start_at);
  const groups: { key: Section; rows: BookingV1[] }[] = [
    { key: "upcoming", rows: rows.filter((r) => r.status === "confirmed" && future(r)) },
    { key: "pending", rows: rows.filter((r) => r.status === "pending") },
    { key: "past", rows: rows.filter((r) => r.status === "completed" || r.status === "no_show" || (r.status === "confirmed" && !future(r))).sort(latest) },
    { key: "cancelled", rows: rows.filter((r) => r.status === "cancelled" || r.status === "declined").sort(latest) },
  ];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.more} />
        <View>
          <Text style={{ fontFamily: font.displayExtrabold, fontSize: 24, color: color.ink }}>{m.title}</Text>
          <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>{m.hint}</Text>
        </View>

        {query.isLoading ? (
          <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : query.isError ? (
          <T kind="soft">{t.mobile.errors.offline}</T>
        ) : rows.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: color.surface }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink, textAlign: "center" }}>{m.empty}</Text>
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${config.webUrl}/coaches`)} style={[styles.cta, { backgroundColor: color.accent }]}>
              <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{m.emptyCta}</Text>
            </Pressable>
          </View>
        ) : (
          groups.filter((g) => g.rows.length > 0).map((g) => (
            <View key={g.key} style={{ gap: 10 }}>
              <T kind="label">{m.sections[g.key]}</T>
              {g.rows.map((row) => <BookingCard key={row.id} row={row} />)}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function pill(status: BookingV1["status"], color: ColorTokens) {
  if (status === "pending") return { bg: color.warnSoft, ink: color.warn };
  if (status === "confirmed") return { bg: color.accentSoft, ink: color.accentInk };
  if (status === "no_show") return { bg: color.riskSoft, ink: color.risk };
  if (status === "completed") return { bg: color.bg, ink: color.inkSoft };
  return { bg: color.bg, ink: color.inkFaint };
}

function BookingCard({ row }: { row: BookingV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const b = t.bookings;
  const tone = pill(row.status, color);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.cancelBooking(row.id, reason.trim() || null);
      if (!r.ok) {
        const code = r.errorCode as keyof typeof b.errors | undefined;
        setError((code && code in b.errors ? b.errors[code] : null) ?? b.errors.generic);
      }
      await queryClient.invalidateQueries({ queryKey: ["bookings"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : b.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: color.surface }]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        {row.coach_avatar ? (
          <Image source={{ uri: row.coach_avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.accentInk }}>{[...row.coach_name.trim()][0]?.toUpperCase() ?? "?"}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            accessibilityRole={row.coach_slug ? "link" : undefined}
            onPress={row.coach_slug ? () => void Linking.openURL(`${config.webUrl}/coaches/${row.coach_slug}`) : undefined}
            style={{ fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}
          >
            {row.coach_name}
          </Text>
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
          {`${row.cancelled_by_me ? b.cancelledByYou : fill(b.cancelledByOther, { name: row.coach_name })}${row.cancellation_reason ? ` · ${fill(b.reason, { reason: row.cancellation_reason })}` : ""}`}
        </Text>
      ) : row.status === "declined" && row.cancellation_reason ? (
        <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{fill(b.reason, { reason: row.cancellation_reason })}</Text>
      ) : null}

      {confirming ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          <TextInput
            autoFocus
            value={reason}
            onChangeText={setReason}
            maxLength={500}
            placeholder={b.reasonPrompt}
            placeholderTextColor={color.inkFaint}
            accessibilityLabel={b.reasonPrompt}
            style={[styles.input, { color: color.ink, backgroundColor: color.bg }]}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void cancel()} style={[styles.button, { backgroundColor: color.accent, opacity: busy ? 0.5 : 1 }]}>
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: color.accentFg }}>{b.mine.cancel}</Text>
            </Pressable>
            <Text accessibilityRole="button" onPress={() => setConfirming(false)} style={{ fontFamily: font.semibold, fontSize: 15, color: color.inkFaint }}>✕</Text>
          </View>
        </View>
      ) : row.can_cancel || row.conversation_id ? (
        <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          {row.can_cancel ? (
            <Pressable accessibilityRole="button" onPress={() => setConfirming(true)} style={[styles.button, { backgroundColor: color.bg }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{b.mine.cancel}</Text>
            </Pressable>
          ) : null}
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
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 16 },
  empty: { alignItems: "center", borderRadius: 24, paddingHorizontal: 24, paddingVertical: 48 },
  cta: { marginTop: 20, height: 44, borderRadius: 16, paddingHorizontal: 20, justifyContent: "center" },
  card: { borderRadius: 24, padding: 16 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  input: { height: 42, borderRadius: 12, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 13.5 },
  button: { height: 40, borderRadius: 12, paddingHorizontal: 16, justifyContent: "center" },
});
