import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChallengeBar, deadlineText, statusTone } from "@/components/challenge-bits";
import { Card, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { alpha, font, useTheme } from "@/lib/theme";
import { parseDay } from "@/lib/week";

// A challenge's own page — the web's /challenges/[id] on a phone: what it
// counts, the big numbers and the bar, the milestones reached, the period and
// the participants, join / leave (and delete for its creator), and the board.

const CHECK = "m5 12 5 5 9-10";
const MILESTONES = [25, 50, 75, 100];

export default function ChallengeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const ch = t.common.challenges;
  const query = useOfflineQuery(`challenge:${id}`, ["challenge", id], () => api.challenge(id));
  const c = query.data?.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tag = locale === "ro" ? "ro-RO" : "en-GB";
  const nf = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" });
  const date = (day: string) => df.format(parseDay(day));

  async function act(kind: "join" | "leave" | "delete") {
    setBusy(true);
    setError(null);
    try {
      const result = kind === "join" ? await api.joinChallenge(id) : kind === "leave" ? await api.leaveChallenge(id) : await api.deleteChallenge(id);
      if (!result.ok) return setError(result.message ?? t.mobile.errors.generic);
      void queryClient.invalidateQueries({ queryKey: ["challenges"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
      if (kind === "delete") return router.back();
      await queryClient.invalidateQueries({ queryKey: ["challenge", id] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : t.mobile.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  const fact = (label: string, value: ReactNode) => (
    <View style={[styles.fact, { backgroundColor: color.bg }]}>
      <Text style={styles.label(color.inkFaint)}>{label}</Text>
      <View style={{ marginTop: 4 }}>{typeof value === "string" ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{value}</Text> : value}</View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={ch.title} />
        {!c ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <Text style={{ flexShrink: 1, fontFamily: font.displayExtrabold, fontSize: 24, color: color.ink }}>{c.title}</Text>
              <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: statusTone(c.status, color).bg }}>
                <Text style={{ fontFamily: font.bold, fontSize: 11, color: statusTone(c.status, color).ink }}>{ch.status[c.status]}</Text>
              </View>
            </View>

            <Card style={{ gap: 0 }}>
              <Text style={styles.label(color.inkFaint)}>{c.subtitle}</Text>
              {c.is_platform ? (
                <View style={{ marginTop: 6, alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: color.accentSoft }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.accentInk }}>{ch.platform}</Text>
                </View>
              ) : null}
              {c.description ? <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{c.description}</Text> : null}
              <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkFaint }}>{c.type_hint}</Text>

              <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
                <Text>
                  <Text style={{ fontFamily: font.displayExtrabold, fontSize: 34, color: color.ink }}>{c.joined ? nf.format(c.progress) : "—"}</Text>
                  <Text style={{ fontFamily: font.medium, fontSize: 13, color: color.inkFaint }}>{`  / ${nf.format(c.target)} ${c.unit_label}`}</Text>
                </Text>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.label(color.inkFaint)}>{ch.progress}</Text>
                  <Text style={{ fontFamily: font.displayExtrabold, fontSize: 20, color: color.ink }}>{`${nf.format(c.joined ? c.pct : 0)}%`}</Text>
                </View>
              </View>
              <View style={{ marginTop: 10 }}>
                <ChallengeBar pct={c.joined ? c.pct : 0} completed={c.status === "completed"} height={10} />
              </View>

              {c.joined ? (
                <View style={{ marginTop: 14 }}>
                  <Text style={styles.label(color.inkFaint)}>{ch.milestones}</Text>
                  <View style={{ marginTop: 6, flexDirection: "row", gap: 6 }}>
                    {MILESTONES.map((m) => {
                      const done = c.milestones.includes(m);
                      return (
                        <View key={m} accessibilityLabel={`${m}%${done ? " ✓" : ""}`} style={[styles.milestone, { backgroundColor: done ? color.accent : color.bg }]}>
                          <Text style={{ fontFamily: font.bold, fontSize: 12, color: done ? color.accentFg : color.inkFaint }}>{`${m}%`}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}
              {c.status === "completed" ? (
                <Text style={{ marginTop: 14, fontFamily: font.displayBold, fontSize: 18, color: color.accentInk }}>{ch.completed}</Text>
              ) : !c.joined ? (
                <Text style={{ marginTop: 10, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{ch.notJoined}</Text>
              ) : null}

              <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {fact(ch.periodLabel, fill(ch.period, { start: date(c.start_date), end: date(c.end_date) }))}
                {fact(ch.status[c.status], deadlineText(c, ch, fill, date))}
                {fact(ch.participantsLabel, c.participants === 1 ? ch.participantsOne : fill(ch.participants, { count: c.participants }))}
                {c.joined ? fact(ch.joined, <NavIcon d={CHECK} size={16} color={color.accentInk} strokeWidth={2.4} />) : null}
              </View>

              <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                {c.joined ? (
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act("leave")} style={[styles.button, { backgroundColor: color.bg, opacity: busy ? 0.5 : 1 }]}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.inkSoft }}>{ch.leave}</Text>
                  </Pressable>
                ) : c.can_join ? (
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act("join")} style={[styles.button, { backgroundColor: color.accent, opacity: busy ? 0.5 : 1, flexGrow: 1 }]}>
                    {busy ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{ch.join}</Text>}
                  </Pressable>
                ) : (
                  <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{ch.endedCannotJoin}</Text>
                )}
                {c.mine ? (
                  <Text accessibilityRole="button" onPress={() => void act("delete")} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{ch.deleteChallenge}</Text>
                ) : null}
              </View>
              {error ? <Text style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
            </Card>

            {c.leaderboard ? (
              <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12 }}>
                  <Text style={styles.label(color.inkFaint)}>{ch.leaderboard}</Text>
                  {c.leaderboard.find((r) => r.me) ? (
                    <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{fill(ch.yourRank, { rank: c.leaderboard.find((r) => r.me)!.rank, total: c.participants })}</Text>
                  ) : null}
                </View>
                {c.leaderboard.map((r) => (
                  <View key={`${r.rank}-${r.name}`} style={[styles.boardRow, { borderTopColor: alpha(color.line, 0.6) }, r.me ? { backgroundColor: color.accentSoft } : null]}>
                    <Text style={{ width: 32, fontFamily: r.rank <= 3 ? font.bold : font.regular, fontSize: 14, color: r.rank <= 3 ? color.accentInk : color.inkFaint }}>{`#${r.rank}`}</Text>
                    <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: color.ink }}>
                      {r.name}
                      {r.me ? <Text style={{ fontSize: 11, color: color.accentInk }}>{`  ${ch.you.toUpperCase()}`}</Text> : null}
                    </Text>
                    <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>
                      <Text style={{ fontFamily: font.displayBold, fontSize: 15, color: color.ink }}>{nf.format(r.value)}</Text>
                      {` ${c.unit_label}`}
                    </Text>
                  </View>
                ))}
              </Card>
            ) : (
              <T kind="faint">{c.participants === 1 ? ch.participantsOne : fill(ch.participants, { count: c.participants })}</T>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = {
  ...StyleSheet.create({
    body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 16 },
    fact: { flexBasis: "46%", flexGrow: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
    milestone: { flex: 1, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    button: { height: 44, minWidth: 120, borderRadius: 16, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
    boardRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1 },
  }),
  label: (ink: string) => ({ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
};
