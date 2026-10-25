import type { CalendarDay } from "@healthapp/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ShareToFeed } from "@/components/share-feed";
import { Card, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";
import { parseDay } from "@/lib/week";

// The streak — the web's /streak on a phone (components/streak.tsx): the card
// with the 12-week calendar, then every milestone reached, each worth sharing
// shareable once. All of it is derived from completed sessions.

const FLAME = "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z";
const TROPHY = "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4";

export default function Streak() {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const s = t.common.streaks;
  const query = useQuery({ queryKey: ["streak"], queryFn: api.streak });
  const v = query.data;
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" });
  const date = (day: string) => df.format(parseDay(day));
  const consecutive = (n: number) => (n === 1 ? s.consecutiveDaysOne : fill(s.consecutiveDays, { count: n }));

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.today} />
        <T kind="title">{s.title}</T>
        {!v ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <Card style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <T kind="label">{s.title}</T>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <NavIcon d={FLAME} size={22} color={color.accent} />
                    <Text style={{ flexShrink: 1, fontFamily: font.displayExtrabold, fontSize: 20, color: color.ink }}>
                      {v.summary.current === 0 ? s.startTitle : v.summary.current === 1 ? s.dayStreakOne : fill(s.dayStreak, { count: v.summary.current })}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>
                    {v.summary.current === 0 ? s.startBody : v.summary.activeToday ? consecutive(v.summary.current) : v.summary.activeYesterday ? s.keepGoing : consecutive(v.summary.current)}
                  </Text>
                </View>
                {v.summary.longest > 0 ? (
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{s.longestStreak}</Text>
                    <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{`${v.summary.longest} ${v.summary.longest === 1 ? s.day : s.days}`}</Text>
                  </View>
                ) : null}
              </View>
              {v.summary.current > 0 && v.next_milestone !== null && v.next_milestone > v.summary.current ? (
                <T kind="faint">{fill(s.nextMilestone, { count: v.next_milestone - v.summary.current, milestone: v.next_milestone })}</T>
              ) : null}
              <View style={{ marginTop: 10 }}>
                <T kind="label">{s.calendarTitle}</T>
                <Calendar calendar={v.calendar} />
              </View>
            </Card>

            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <NavIcon d={TROPHY} size={15} color={color.inkFaint} />
                <T kind="label">{s.milestones}</T>
              </View>
              {v.milestones.length === 0 ? <T kind="faint">{s.noMilestones}</T> : null}
              {v.milestones.map((m, i) => (
                <View key={`${m.milestone}-${m.streak_start}`} style={[{ gap: 8, paddingTop: i > 0 ? 10 : 0 }, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line } : null]}>
                  <View>
                    <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{fill(s.milestoneTitle, { count: m.milestone })}</Text>
                    <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{fill(s.reachedOn, { date: date(m.reached_on) })}</Text>
                  </View>
                  {m.milestone >= v.share_min ? (
                    <ShareToFeed shared={m.shared} share={(visibility) => api.shareStreak(m.milestone, m.streak_start, visibility)} />
                  ) : null}
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Twelve weeks as columns, weekdays as rows; a filled square for a day with a completed workout. Tap a day for its line. */
function Calendar({ calendar }: { calendar: CalendarDay[][] }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const s = t.common.streaks;
  const [picked, setPicked] = useState<CalendarDay | null>(null);
  const narrow = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { weekday: "narrow" });
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" });
  const label = (d: CalendarDay) => `${df.format(parseDay(d.day))} — ${d.workouts === 0 ? s.restDay : d.workouts === 1 ? s.workout : fill(s.workouts, { count: d.workouts })}`;
  const weekdays = (calendar[0] ?? []).map((d) => narrow.format(parseDay(d.day)));
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: "row", gap: 4 }}>
        <View style={{ gap: 4, paddingRight: 2 }}>
          {weekdays.map((w, i) => (
            <Text key={i} style={{ height: 16, lineHeight: 16, fontFamily: font.regular, fontSize: 9, color: color.inkFaint }}>{i % 2 === 0 ? w : ""}</Text>
          ))}
        </View>
        {calendar.map((week, wi) => (
          <View key={wi} style={{ flex: 1, gap: 4 }}>
            {week.map((d) => (
              <Pressable
                key={d.day}
                disabled={d.future}
                accessibilityLabel={d.future ? undefined : label(d)}
                onPress={() => setPicked(d)}
                style={{
                  height: 16,
                  borderRadius: 4,
                  backgroundColor: d.future ? "transparent" : d.workouts > 0 ? color.accent : color.line,
                  borderWidth: picked?.day === d.day ? 2 : 0,
                  borderColor: color.accentInk,
                }}
              />
            ))}
          </View>
        ))}
      </View>
      <Text style={{ marginTop: 8, minHeight: 16, fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{picked && !picked.future ? label(picked) : " "}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
});
