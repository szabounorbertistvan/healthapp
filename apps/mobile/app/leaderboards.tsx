import type { LeaderboardRow } from "@healthapp/shared";
import { LEADERBOARD_METRICS, LEADERBOARD_PERIODS, LEADERBOARD_SCOPES, type LeaderboardMetric, type LeaderboardPeriod, type LeaderboardScope } from "@healthapp/shared";
import { useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { alpha, font, useTheme } from "@/lib/theme";

// Leaderboards — the web's /leaderboards on a phone: who is ranked (everyone,
// people I follow, my gym), the period, the metric, then one board — the top
// ten and, under a rule, the viewer's own row when they rank below them.

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default function Leaderboards() {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const l = t.common.leaderboards;
  const gb = t.gyms.board;
  const [metric, setMetric] = useState<LeaderboardMetric>("training_load");
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [scope, setScope] = useState<LeaderboardScope>("global");
  const key = `${metric}:${period}:${scope}`;
  const query = useOfflineQuery(`leaderboard:${key}`, ["leaderboard", key], () => api.leaderboard(metric, period, scope));
  const data = query.data?.data;
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 0 });

  const segment = <V extends string>(values: readonly V[], value: V, set: (v: V) => void, label: (v: V) => string) => (
    <View style={[styles.segment, { backgroundColor: color.surface }]}>
      {values.map((v) => {
        const on = v === value;
        return (
          <Pressable key={v} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => set(v)} style={[styles.segmentItem, on ? { backgroundColor: color.accent } : null]}>
            <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentFg : color.inkSoft }}>{label(v)}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const row = (r: LeaderboardRow, first: boolean) => (
    <View
      key={r.user_id}
      style={[styles.row, first ? null : { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) }, r.is_current_user ? { backgroundColor: color.accentSoft } : null]}
    >
      <Text style={{ width: 28, textAlign: "center", fontFamily: r.rank <= 3 ? font.bold : font.semibold, fontSize: 15, color: r.rank <= 3 ? color.ink : color.inkFaint }}>
        {MEDALS[r.rank] ?? r.rank}
      </Text>
      {r.avatar_url ? (
        <Image source={{ uri: r.avatar_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, { backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }]}>
          <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentInk }}>{[...r.display_name.trim()][0]?.toUpperCase() ?? "?"}</Text>
        </View>
      )}
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: color.ink }}>
        {r.display_name}
        {r.is_current_user ? <Text style={{ fontSize: 11, letterSpacing: 0.6, color: color.accentInk }}>{`  ${l.you.toUpperCase()}`}</Text> : null}
      </Text>
      <Text style={{ fontFamily: font.displayBold, fontSize: 15, color: color.ink }}>
        {nf.format(r.score)}
        {l.units[metric] ? <Text style={{ fontFamily: font.medium, fontSize: 11.5, color: color.inkFaint }}>{` ${l.units[metric]}`}</Text> : null}
      </Text>
    </View>
  );

  const empty = (title: string, hint: string, action?: { label: string; path: string }) => (
    <View style={{ paddingVertical: 8, gap: 4 }}>
      <T kind="heading">{title}</T>
      <T kind="faint">{hint}</T>
      {action ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${config.webUrl}${action.path}`)} style={[styles.pill, { backgroundColor: color.surface, marginTop: 8 }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const board = data?.board;
  const meBelow = board && board.me !== null && !board.entries.some((r) => r.is_current_user);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.today} />
        <T kind="title">{l.title}</T>
        {segment(LEADERBOARD_SCOPES, scope, setScope, (s) => l.scopes[s])}
        {segment(LEADERBOARD_PERIODS, period, setPeriod, (p) => l.periods[p])}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {LEADERBOARD_METRICS.map((m) => {
            const on = m === metric;
            return (
              <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setMetric(m)} style={[styles.pill, { backgroundColor: on ? color.accentSoft : color.surface }]}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentInk : color.inkSoft }}>{l.metrics[m]}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {!data || !board ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : scope === "following" && board.entries.length === 0 ? (
          empty(l.emptyFollowing, l.emptyFollowingHint)
        ) : scope === "gym" && !data.gym?.home ? (
          empty(gb.noGymTitle, gb.noGymHint, { label: gb.pickGym, path: "/account" })
        ) : scope === "gym" && !data.gym?.board ? (
          empty(gb.optInTitle, gb.optInHint, { label: gb.optIn, path: "/account" })
        ) : scope === "gym" && board.entries.length <= 1 ? (
          empty(gb.emptyTitle, gb.emptyHint)
        ) : (
          <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12 }}>
              <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{l.metrics[metric]}</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{l.periods[period]}</Text>
            </View>
            {board.entries.length === 0 ? (
              <Text style={{ paddingHorizontal: 20, paddingBottom: 18, fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{l.emptyBoard}</Text>
            ) : (
              <View style={{ borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) }}>
                {board.entries.map((r, i) => row(r, i === 0))}
                {meBelow && board.me ? (
                  <>
                    <Text style={{ paddingVertical: 4, textAlign: "center", fontSize: 12, color: color.inkFaint }}>···</Text>
                    {row(board.me, false)}
                  </>
                ) : null}
              </View>
            )}
            {board.me === null && board.entries.length > 0 ? (
              <Text style={{ borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6), paddingHorizontal: 20, paddingVertical: 12, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                {l.notRanked}
              </Text>
            ) : null}
          </Card>
        )}
        {board?.me ? <T kind="faint">{fill(l.yourRank, { rank: board.me.rank, metric: l.metrics[metric], period: l.periods[period].toLowerCase() })}</T> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 12 },
  segment: { flexDirection: "row", gap: 4, borderRadius: 999, padding: 4, alignSelf: "flex-start" },
  segmentItem: { height: 36, borderRadius: 999, paddingHorizontal: 14, justifyContent: "center" },
  pill: { height: 36, borderRadius: 18, paddingHorizontal: 16, justifyContent: "center", alignSelf: "flex-start" },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
});
