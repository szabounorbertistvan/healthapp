import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// Book a session — the web's /coaches/[slug]/book on a phone
// (components/booking-picker.tsx): a week of free starts in the coach's time
// zone (coach_booking_slots), a day, a time, an optional note, then
// book_service(), which re-checks the start and refuses anything it would not
// offer now. Nothing is paid here.

const DAY_MS = 86_400_000;

export default function Book() {
  const { slug, service } = useLocalSearchParams<{ slug: string; service: string }>();
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const b = t.coachProfile.bookings.book;
  const errs = t.coachProfile.bookings.errors;
  const page = useQuery({ queryKey: ["coach-page", slug], queryFn: () => api.coachPage(slug) });
  const c = page.data;
  const s = c?.services.find((x) => x.id === service);
  const [weekStart, setWeekStart] = useState(() => new Date().toISOString().slice(0, 10));
  const slots = useQuery({ queryKey: ["coach-slots", service, weekStart], queryFn: () => api.coachSlots(service, weekStart, 7), enabled: Boolean(service) });
  const tz = c?.timezone ?? undefined;
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const dayLabel = (iso: string) => new Intl.DateTimeFormat(tag, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
  const timeLabel = (iso: string) => new Intl.DateTimeFormat(tag, { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const byDay = new Map<string, { start_at: string; end_at: string }[]>();
  for (const x of slots.data ?? []) byDay.set(dayKey(x.start_at), [...(byDay.get(dayKey(x.start_at)) ?? []), x]);
  const days = [...byDay.keys()];
  const [day, setDay] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const shownDay = day && byDay.has(day) ? day : days[0] ?? null;

  function shift(weeks: number) {
    const next = new Date(new Date(`${weekStart}T12:00:00Z`).getTime() + weeks * 7 * DAY_MS).toISOString().slice(0, 10);
    if (next < new Date().toISOString().slice(0, 10)) return;
    setWeekStart(next);
    setDay(null);
    setPick(null);
  }

  async function confirm() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.coachAct({ op: "book", serviceId: service, startAt: pick, note: note.trim() || null });
      if (!r.ok) {
        const code = r.errorCode as keyof typeof errs | undefined;
        void slots.refetch();
        return setError((code && code in errs ? errs[code] : null) ?? errs.generic);
      }
      setDone(true);
      void queryClient.invalidateQueries({ queryKey: ["bookings"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : errs.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <BackHeader label={c ? fill(b.back, { name: c.name }) : t.common.actions.back} />
        <View>
          <T kind="title">{b.title}</T>
          {c ? <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft }}>{fill(b.with, { name: c.name })}</Text> : null}
        </View>
        {!c ? <ActivityIndicator color={color.accent} /> : !s || s.book !== "ok" ? <T kind="soft">{b.notBookable}</T> : done ? (
          <Card style={{ gap: 8 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{b.booked}</Text>
            <T kind="soft">{b.bookedBody}</T>
            <View style={{ alignSelf: "flex-start" }}><Button height={42} label={b.myBookings} onPress={() => router.replace("/bookings")} /></View>
          </Card>
        ) : (
          <>
            <Card style={{ gap: 4 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 15, color: color.ink }}>{s.name}</Text>
              {s.duration ? <T kind="faint">{s.duration}</T> : null}
              {s.price ? <T kind="faint">{fill(b.priceNote, { price: s.price })}</T> : null}
              {tz ? <T kind="faint">{fill(b.zoneNote, { zone: tz.split("/").pop()!.replace(/_/g, " ") })}</T> : null}
            </Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text accessibilityRole="button" onPress={() => shift(-1)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{`‹ ${b.prevWeek}`}</Text>
              <Text accessibilityRole="button" onPress={() => shift(1)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{`${b.nextWeek} ›`}</Text>
            </View>
            {slots.isLoading ? <ActivityIndicator color={color.accent} /> : days.length === 0 ? <T kind="faint">{b.noSlotsWeek}</T> : (
              <>
                <T kind="label">{b.chooseDay}</T>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {days.map((d) => (
                    <Pressable key={d} accessibilityRole="radio" accessibilityState={{ checked: d === shownDay }} onPress={() => { setDay(d); setPick(null); }} style={[styles.chip, { backgroundColor: d === shownDay ? color.accent : color.surface }]}>
                      <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: d === shownDay ? color.accentFg : color.inkSoft }}>{dayLabel(byDay.get(d)![0]!.start_at)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <T kind="label">{b.chooseTime}</T>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {(shownDay ? byDay.get(shownDay) ?? [] : []).map((x) => (
                    <Pressable key={x.start_at} accessibilityRole="radio" accessibilityState={{ checked: x.start_at === pick }} onPress={() => setPick(x.start_at)} style={[styles.time, { backgroundColor: x.start_at === pick ? color.accent : color.surface }]}>
                      <Text style={{ fontFamily: font.semibold, fontSize: 13, color: x.start_at === pick ? color.accentFg : color.ink }}>{timeLabel(x.start_at)}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            {pick ? (
              <Card style={{ gap: 8 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{fill(b.selected, { date: dayLabel(pick), time: timeLabel(pick) })}</Text>
                <TextInput value={note} onChangeText={setNote} multiline maxLength={1000} placeholder={b.note} placeholderTextColor={color.inkFaint} accessibilityLabel={b.note} style={[styles.area, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
                <View style={{ alignSelf: "flex-start" }}><Button height={44} label={b.confirm} busy={busy} onPress={() => void confirm()} /></View>
              </Card>
            ) : null}
            {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  chip: { height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
  time: { width: 76, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  area: { minHeight: 70, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: "top", fontFamily: font.regular, fontSize: 13.5 },
});
