import type { ChallengesV1 } from "@healthapp/api/v1";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { font, useTheme } from "@/lib/theme";
import { parseDay } from "@/lib/week";

// Challenges — the web's /challenges on a phone: every challenge the person
// can see, grouped by where it stands for them (active, upcoming, completed,
// ended), each card with its progress from the database. Join and leave work
// here; a challenge's own page and creating one open on the web.

type ChallengeItem = ChallengesV1["cards"][number];
type Status = ChallengeItem["status"];

const CLOCK = "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 7v5l3 2";
const PEOPLE = "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M18 20h4a6 6 0 0 0-3-5.2";
/** challenges.tsx TYPE_ICON: what the challenge counts. */
const TYPE_ICON: Record<string, string> = {
  workouts: "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8",
  training_load: "M4 18a8 8 0 1 1 16 0M12 18l4-5",
  volume: "M4 19h16M7 19V9M12 19V5M17 19v-6",
  active_days: "M8 3v3M16 3v3M5 6h14v14H5zM4 10h16M9 15l2 2 4-4",
  exercise_sessions: "M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11",
  strength_gain: "M4 17l5-5 3 3 7-7M15 8h5v5",
  check_ins: "M9 4h6v3H9zM6 5h12v16H6zM9 13l2 2 4-4",
  nutrition_days: "M7 3v7a2 2 0 0 0 4 0V3M9 10v11M16 3c-1.5 2-2 4-2 7h4c0-3-.5-5-2-7zM16 10v11",
  habit_completions: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M8 12l3 3 5-6",
};

export default function Challenges() {
  const { t } = useI18n();
  const { color } = useTheme();
  const ch = t.common.challenges;
  const query = useOfflineQuery("challenges", ["challenges"], api.challenges);
  const cards = query.data?.data.cards;
  const groups: Status[] = ["active", "upcoming", "completed", "ended"];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.today} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <T kind="title">{ch.title}</T>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${config.webUrl}/challenges`)} style={[styles.pill, { backgroundColor: color.accent }]}>
            <NavIcon d="M12 5v14M5 12h14" size={16} color={color.accentFg} strokeWidth={2.4} />
            <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: color.accentFg }}>{ch.create}</Text>
          </Pressable>
        </View>

        {!cards ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : cards.length === 0 ? (
          <View style={{ paddingVertical: 8 }}>
            <T kind="heading">{ch.empty}</T>
            <T kind="faint" style={{ marginTop: 4 }}>{ch.emptyHint}</T>
          </View>
        ) : (
          groups.map((status) => {
            const items = cards.filter((c) => c.status === status);
            if (items.length === 0) return null;
            return (
              <View key={status} style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontFamily: font.bold, fontSize: 12, letterSpacing: 0.72, textTransform: "uppercase", color: color.inkSoft }}>{ch.sections[status]}</Text>
                  <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: color.surface }}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.inkFaint }}>{items.length}</Text>
                  </View>
                </View>
                {items.map((c) => <ChallengeCard key={c.id} c={c} />)}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ChallengeCard({ c }: { c: ChallengeItem }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const ch = t.common.challenges;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const nf = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" });
  const completed = c.status === "completed";
  const tone = {
    active: { bg: color.accentSoft, ink: color.accentInk },
    upcoming: { bg: color.bg, ink: color.inkSoft },
    completed: { bg: color.accent, ink: color.accentFg },
    ended: { bg: color.bg, ink: color.inkFaint },
  }[c.status];

  // challenges.tsx deadlineText
  const deadline = (() => {
    if (c.status === "upcoming") {
      const days = Math.max(1, Math.round((parseDay(c.start_date).getTime() - Date.now()) / 86_400_000));
      return days === 1 ? ch.startsTomorrow : fill(ch.startsIn, { days });
    }
    if (c.status === "ended") return fill(ch.endedOn, { date: df.format(parseDay(c.end_date)) });
    if (c.status === "completed" && c.completed_at) return fill(ch.completedOn, { date: df.format(parseDay(c.completed_at.slice(0, 10))) });
    return c.days_remaining === 1 ? ch.oneDayRemaining : fill(ch.daysRemaining, { days: c.days_remaining });
  })();

  async function act(join: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = join ? await api.joinChallenge(c.id) : await api.leaveChallenge(c.id);
      if (!result.ok) setError(result.message ?? t.mobile.errors.generic);
      await queryClient.invalidateQueries({ queryKey: ["challenges"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : t.mobile.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${config.webUrl}/challenges/${c.id}`)}>
      <Card style={{ gap: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <NavIcon d={TYPE_ICON[c.type] ?? TYPE_ICON.workouts!} size={44} color={color.accentInk} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{c.title}</Text>
              <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{c.subtitle}</Text>
            </View>
          </View>
          <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: tone.bg }}>
            <Text style={{ fontFamily: font.bold, fontSize: 11, color: tone.ink }}>{ch.status[c.status]}</Text>
          </View>
        </View>
        {c.is_platform ? (
          <View style={{ marginTop: 8, alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: color.accentSoft }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.accentInk }}>{ch.platform}</Text>
          </View>
        ) : null}
        {c.description ? <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 13, lineHeight: 20, color: color.inkSoft }}>{c.description}</Text> : null}

        <View style={{ marginTop: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            {c.joined ? (
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                <Text style={{ fontFamily: font.displayExtrabold, fontSize: 16, color: color.ink }}>{nf.format(c.progress)}</Text>
                {` / ${nf.format(c.target)} ${c.unit_label}`}
              </Text>
            ) : (
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{`${ch.target}: ${nf.format(c.target)} ${c.unit_label}`}</Text>
            )}
            {c.joined ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{`${nf.format(c.pct)}%`}</Text> : null}
          </View>
          <View style={{ marginTop: 6, height: 8, borderRadius: 999, overflow: "hidden", backgroundColor: color.bg }}>
            <View style={{ height: "100%", borderRadius: 999, width: `${Math.min(100, c.joined ? c.pct : 0)}%`, backgroundColor: completed || c.pct >= 50 ? color.accent : color.inkSoft }} />
          </View>
        </View>

        <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <NavIcon d={CLOCK} size={18} color={color.accentInk} />
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{deadline}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <NavIcon d={PEOPLE} size={18} color={color.accentInk} />
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{c.participants === 1 ? ch.participantsOne : fill(ch.participants, { count: c.participants })}</Text>
          </View>
        </View>

        <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          {completed ? (
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{ch.completed}</Text>
          ) : c.joined ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act(false)} style={[styles.pill, { backgroundColor: color.bg, opacity: busy ? 0.5 : 1 }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{ch.leave}</Text>
            </Pressable>
          ) : c.can_join ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act(true)} style={[styles.pill, { backgroundColor: color.accent, opacity: busy ? 0.5 : 1 }]}>
              <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: color.accentFg }}>{ch.join}</Text>
            </Pressable>
          ) : (
            <View />
          )}
          <View style={{ width: 32, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: color.accentSoft }}>
            <NavIcon d="m9 6 6 6-6 6" size={14} color={color.accentInk} strokeWidth={2.2} />
          </View>
        </View>
        {error ? <Text style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 16 },
  pill: { height: 36, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 18, paddingHorizontal: 14 },
});
