import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChallengeBar, statusTone } from "@/components/challenge-bits";
import { Card, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { alpha, font, useTheme } from "@/lib/theme";

// Which challenges the coach's active clients joined and how far each one is —
// the web's /clients/challenges on a phone. Read-only: challenges are
// platform-owned; this is a view of the roster.

const TROPHY = "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4";

export default function ClientChallenges() {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const ch = t.common.challenges;
  const query = useQuery({ queryKey: ["coach-challenges"], queryFn: api.coachChallenges });
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 1 });
  const rows = query.data ?? [];
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}>
        <BackHeader label={t.common.nav.clients} />
        <T kind="title">{ch.coachTitle}</T>
        {!query.data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : rows.length === 0 ? (
          <Card style={{ alignItems: "center", paddingVertical: 28 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink, textAlign: "center" }}>{ch.coachEmpty}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft, textAlign: "center" }}>{ch.emptyHint}</Text>
          </Card>
        ) : rows.map(({ challenge: c, clients }) => {
          const tone = statusTone(c.status, color);
          const type = (ch.type as Record<string, string>)[c.type] ?? c.type;
          const unit = (ch.unit as Record<string, string>)[c.type] ?? "";
          return (
            <Card key={c.id} style={{ padding: 0, gap: 0, overflow: "hidden" }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{c.title}</Text>
                  <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkFaint }}>
                    {`${type} · ${ch.target}: ${nf.format(c.target)} ${unit} · ${clients.length === 1 ? ch.coachClientsInOne : fill(ch.coachClientsIn, { count: clients.length })}`}
                  </Text>
                </View>
                <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: tone.bg }}>
                  <Text style={{ fontFamily: font.bold, fontSize: 11, color: tone.ink }}>{ch.status[c.status]}</Text>
                </View>
              </View>
              {clients.slice().sort((a, b) => b.progress - a.progress).map((cl) => (
                <View key={cl.client_id} style={{ paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                    <View style={{ flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{cl.name}</Text>
                      {cl.completed ? <NavIcon d={TROPHY} size={15} color={color.accentInk} /> : null}
                    </View>
                    <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                      <Text style={{ fontFamily: font.displayExtrabold, fontSize: 15, color: color.ink }}>{nf.format(cl.progress)}</Text>
                      {` / ${nf.format(c.target)} · ${nf.format(cl.pct)}%`}
                    </Text>
                  </View>
                  <View style={{ marginTop: 8 }}><ChallengeBar pct={cl.pct} completed={cl.completed} /></View>
                </View>
              ))}
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
});
