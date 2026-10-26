import type { CoachAvailabilityV1 } from "@healthapp/api/v1";
import { availabilityProblems, bookingSettingsProblems, WEEKDAYS, type BookingSettings } from "@healthapp/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Field, Hint, Pills, Switch } from "@/components/settings-forms";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The coach's availability — the web's /bookings/availability on a phone
// (components/availability-editor.tsx): the weekly hours day by day, time off,
// and each service's booking settings, all in the coach's own zone. Each form
// checks itself with the database's rules (@healthapp/shared booking) before it
// is sent; the server still has the last word (OVERLAP, INVALID_INTERVAL). A
// phone has no time or date box to borrow, so times are typed as 09:30 and
// dates as yyyy-mm-dd. Calendar connections are not switched on yet.

type Data = CoachAvailabilityV1;
type Write = { op: string } & Record<string, unknown>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** One write, its refusal named the web's way (bookings.errors), then a fresh read. */
function useWrite() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const e = t.coachProfile.bookings.errors;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (body: Write, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.coachAvailability(body);
      if (!r.ok) {
        const code = r.errorCode as keyof typeof e | undefined;
        setError((code && code in e ? e[code] : null) ?? e.generic);
      } else after?.();
      await queryClient.invalidateQueries({ queryKey: ["coach-availability"] });
      void queryClient.invalidateQueries({ queryKey: ["coach-marketplace"] });
    } catch (err) {
      setError(err instanceof ApiFailure && err.kind === "offline" ? t.mobile.errors.offline : e.generic);
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error };
}

export default function CoachAvailability() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const a = t.coachProfile.bookings.availability;
  const query = useQuery({ queryKey: ["coach-availability"], queryFn: api.coachAvailabilityRead });
  const data = query.data;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={a.back} />
        <View>
          <T kind="title">{a.title}</T>
          <Text style={[styles.hint, { color: color.inkSoft }]}>{a.hint}</Text>
          {data ? (
            <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>
              {`${fill(a.zone, { zone: data.timezone })} · `}
              <Text accessibilityRole="link" onPress={() => router.push("/more")} style={{ fontFamily: font.semibold, color: color.accentInk }}>{a.changeZone}</Text>
            </Text>
          ) : null}
        </View>
        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : (
          <>
            <Text style={[styles.section, { color: color.ink }]}>{a.week}</Text>
            <WeeklyHours blocks={data.blocks} />

            <View>
              <Text style={[styles.section, { color: color.ink }]}>{a.timeOff}</Text>
              <Text style={[styles.hint, { color: color.inkSoft }]}>{a.timeOffHint}</Text>
            </View>
            <TimeOff exceptions={data.exceptions} today={data.today} />

            <View>
              <Text style={[styles.section, { color: color.ink }]}>{a.services}</Text>
              <Text style={[styles.hint, { color: color.inkSoft }]}>{a.servicesHint}</Text>
            </View>
            {!data.has_profile ? (
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>
                {`${a.noProfile} `}
                <Text accessibilityRole="link" onPress={() => router.push("/coach/profile")} style={{ fontFamily: font.semibold, color: color.accentInk }}>→</Text>
              </Text>
            ) : data.services.length === 0 ? (
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{a.noServices}</Text>
            ) : (
              data.services.map((s) => <ServiceBooking key={`${s.id}:${s.bookable}:${s.duration_minutes}`} service={s} />)
            )}

            <View>
              <Text style={[styles.section, { color: color.ink }]}>{a.calendar.title}</Text>
              <Text style={[styles.hint, { color: color.inkSoft }]}>{a.calendar.hint}</Text>
            </View>
            <View style={[styles.card, { backgroundColor: color.surface }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{a.calendar.comingSoon}</Text>
              <Hint>{a.calendar.comingSoonHint}</Hint>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function weekdayName(weekday: number, locale: "en" | "ro") {
  // 2024-01-01 was a Monday: ISO weekday n is that date + n - 1
  return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, weekday)));
}

function WeeklyHours({ blocks }: { blocks: Data["blocks"] }) {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const a = t.coachProfile.bookings.availability;
  const { run, busy, error } = useWrite();
  const [adding, setAdding] = useState<number | null>(null);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("13:00");
  const draftProblems = adding === null ? [] : availabilityProblems([...blocks, { weekday: adding, start: from, end: to, active: true }])[blocks.length] ?? [];

  return (
    <View style={{ gap: 8 }}>
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: color.risk }]}>{error}</Text> : null}
      {WEEKDAYS.map((wd) => {
        const day = blocks.filter((b) => b.weekday === wd);
        return (
          <View key={wd} style={[styles.card, { backgroundColor: color.surface }]}>
            <View style={styles.rowBetween}>
              <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: color.ink, textTransform: "capitalize" }}>{weekdayName(wd, locale)}</Text>
              {adding !== wd ? (
                <Small label={`+ ${a.addHours}`} onPress={() => { setAdding(wd); setFrom("09:00"); setTo("13:00"); }} />
              ) : null}
            </View>
            {day.length === 0 && adding !== wd ? <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{a.unavailable}</Text> : null}
            {day.map((b) => (
              <View key={b.id} style={{ marginTop: 8, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <Text style={{ fontFamily: font.displayBold, fontSize: 15, color: b.active ? color.ink : color.inkFaint, textDecorationLine: b.active ? "none" : "line-through" }}>{`${b.start} — ${b.end}`}</Text>
                <Small label={b.active ? a.on : a.off} disabled={busy} onPress={() => void run({ op: "update", id: b.id, weekday: b.weekday, start: b.start, end: b.end, active: !b.active })} />
                <Text accessibilityRole="button" onPress={busy ? undefined : () => void run({ op: "delete", id: b.id })} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{a.remove}</Text>
              </View>
            ))}
            {adding === wd ? (
              <View style={{ marginTop: 12, gap: 10 }}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Field style={{ flex: 1 }} label={a.from} value={from} onChange={setFrom} plain keyboardType="numbers-and-punctuation" maxLength={5} placeholder="09:00" />
                  <Field style={{ flex: 1 }} label={a.to} value={to} onChange={setTo} plain keyboardType="numbers-and-punctuation" maxLength={5} placeholder="13:00" />
                </View>
                {draftProblems.length ? <Text style={[styles.error, { color: color.risk }]}>{a.problems[draftProblems[0]!]}</Text> : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                  <Primary label={a.add} disabled={busy || draftProblems.length > 0} onPress={() => void run({ op: "add", weekday: wd, start: from, end: to, active: true }, () => setAdding(null))} />
                  <Text accessibilityRole="button" onPress={() => setAdding(null)} style={{ fontFamily: font.semibold, fontSize: 15, color: color.inkFaint }}>✕</Text>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function TimeOff({ exceptions, today }: { exceptions: Data["exceptions"]; today: string }) {
  const { t, locale, fill } = useI18n();
  const { color } = useTheme();
  const a = t.coachProfile.bookings.availability;
  const { run, busy, error } = useWrite();
  const [allDay, setAllDay] = useState(true);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("12:00");
  const [title, setTitle] = useState("");
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const badDate = !DAY.test(startDate) || (allDay && !DAY.test(endDate)) || startDate < today;
  const badTime = !allDay && (availabilityProblems([{ weekday: 1, start: from, end: to, active: true }])[0] ?? []).length > 0;
  const invalid = badDate || badTime || (allDay ? endDate < startDate : false);

  return (
    <View style={{ gap: 8 }}>
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: color.risk }]}>{error}</Text> : null}
      {exceptions.length === 0 ? <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{a.noTimeOff}</Text> : (
        exceptions.map((e) => (
          <View key={e.id} style={[styles.card, styles.rowBetween, { backgroundColor: color.surface, paddingVertical: 12 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>
                {e.all_day
                  ? `${e.start_date === e.end_date ? date(e.start_date) : `${date(e.start_date)} — ${date(e.end_date)}`} · ${a.allDay}`
                  : `${date(e.start_date)} · ${e.start ?? ""} — ${e.end ?? ""}`}
              </Text>
              {e.title ? <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{e.title}</Text> : null}
            </View>
            <Text accessibilityRole="button" onPress={busy ? undefined : () => void run({ op: "deleteTimeOff", id: e.id })} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{a.remove}</Text>
          </View>
        ))
      )}
      <View style={[styles.card, { backgroundColor: color.surface, gap: 12 }]}>
        <Switch label={a.allDay} value={allDay} onChange={setAllDay} onLabel={a.on} offLabel={a.off} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field style={{ flex: 1 }} label={allDay ? a.startDate : a.date} value={startDate} plain keyboardType="numbers-and-punctuation" maxLength={10} placeholder={today}
            onChange={(v) => { setStartDate(v); if (DAY.test(v) && v > endDate) setEndDate(v); }} />
          {allDay ? (
            <Field style={{ flex: 1 }} label={a.endDate} value={endDate} onChange={setEndDate} plain keyboardType="numbers-and-punctuation" maxLength={10} placeholder={today} />
          ) : null}
        </View>
        {!allDay ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Field style={{ flex: 1 }} label={a.from} value={from} onChange={setFrom} plain keyboardType="numbers-and-punctuation" maxLength={5} placeholder="10:00" />
            <Field style={{ flex: 1 }} label={a.to} value={to} onChange={setTo} plain keyboardType="numbers-and-punctuation" maxLength={5} placeholder="12:00" />
          </View>
        ) : null}
        {badDate ? <Hint tone={color.risk}>{fill(t.mobile.forms.dateFormat, { example: today })}</Hint>
          : badTime ? <Hint tone={color.risk}>{a.problems.END_BEFORE_START}</Hint> : null}
        <Field label={a.reason} value={title} onChange={setTitle} maxLength={100} />
        <View style={{ alignSelf: "flex-start" }}>
          <Primary label={a.addTimeOff} disabled={busy || invalid}
            onPress={() => void run({ op: "addTimeOff", startDate, endDate: allDay ? endDate : startDate, allDay, start: allDay ? null : from, end: allDay ? null : to, title: title.trim() || null }, () => setTitle(""))} />
        </View>
      </View>
    </View>
  );
}

function ServiceBooking({ service }: { service: Data["services"][number] }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const a = t.coachProfile.bookings.availability;
  const { run, busy, error } = useWrite();
  const [s, setS] = useState<BookingSettings>(() => ({
    bookable: service.bookable,
    durationMinutes: service.duration_minutes ?? 60,
    bufferBeforeMinutes: service.buffer_before_minutes,
    bufferAfterMinutes: service.buffer_after_minutes,
    minNoticeMinutes: service.min_notice_minutes,
    maxAdvanceDays: service.max_advance_days,
    access: service.access,
    confirmation: service.confirmation,
  }));
  const [saved, setSaved] = useState(false);
  const problems = bookingSettingsProblems(s, service.delivery);
  const set = (patch: Partial<BookingSettings>) => { setSaved(false); setS({ ...s, ...patch }); };
  // a number field: what is typed, scaled into minutes (hours × 60 for the notice)
  const num = (key: "durationMinutes" | "bufferBeforeMinutes" | "bufferAfterMinutes" | "minNoticeMinutes" | "maxAdvanceDays", label: string, scale = 1) => (
    <Field style={{ flexBasis: "47%", flexGrow: 1 }} label={label} plain keyboardType="number-pad" maxLength={4}
      value={String(Math.round((s[key] ?? 0) / scale))}
      onChange={(v) => set({ [key]: v.trim() === "" || !/^\d+$/.test(v.trim()) ? 0 : Math.round(Number(v) * scale) })} />
  );

  return (
    <View style={[styles.card, { backgroundColor: color.surface }]}>
      <View style={styles.rowBetween}>
        <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{service.name}</Text>
        {!service.active ? <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{a.inactive}</Text> : null}
      </View>
      {service.delivery === "digital" ? <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{a.digital}</Text> : (
        <View style={{ marginTop: 12, gap: 12 }}>
          <Switch label={a.bookable} value={s.bookable} onChange={(v) => set({ bookable: v })} onLabel={a.on} offLabel={a.off} />
          {s.bookable ? (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {num("durationMinutes", a.duration)}
                {num("bufferBeforeMinutes", a.bufferBefore)}
                {num("bufferAfterMinutes", a.bufferAfter)}
                {num("minNoticeMinutes", a.minNotice, 60)}
                {num("maxAdvanceDays", a.maxAdvance)}
              </View>
              <Pills label="" value={s.access} onChange={(v) => set({ access: v })}
                options={[{ value: "public", label: a.access.public }, { value: "clients", label: a.access.clients }]} />
              <Pills label="" value={s.confirmation} onChange={(v) => set({ confirmation: v })}
                options={[{ value: "approval", label: a.confirmation.approval }, { value: "instant", label: a.confirmation.instant }]} />
            </>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: color.risk }]}>{error}</Text> : null}
          {problems.length && !error ? <Text style={[styles.error, { color: color.risk }]}>{t.coachProfile.bookings.errors.INVALID_BOOKING_SETTINGS}</Text> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Primary label={a.save} disabled={busy || problems.length > 0} onPress={() => void run({ op: "service", serviceId: service.id, ...s }, () => setSaved(true))} />
            {saved ? <Text accessibilityRole="text" style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{a.saved}</Text> : null}
          </View>
        </View>
      )}
    </View>
  );
}

function Small({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.small, { backgroundColor: color.bg, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{label}</Text>
    </Pressable>
  );
}

function Primary({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.primary, { backgroundColor: color.accent, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={{ fontFamily: font.bold, fontSize: 13.5, color: color.accentFg }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  hint: { marginTop: 4, fontFamily: font.regular, fontSize: 13, lineHeight: 19 },
  section: { fontFamily: font.displayBold, fontSize: 18, marginTop: 6 },
  card: { borderRadius: 20, padding: 16 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  error: { fontFamily: font.semibold, fontSize: 12.5 },
  small: { height: 32, borderRadius: 16, paddingHorizontal: 12, justifyContent: "center" },
  primary: { height: 42, borderRadius: 14, paddingHorizontal: 18, justifyContent: "center" },
});
