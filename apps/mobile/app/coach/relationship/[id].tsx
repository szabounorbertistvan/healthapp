import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Primary, Small } from "@/components/coach-profile-bits";
import { CoachingActions, RelationshipPill, RelationshipTimeline } from "@/components/coaching-lifecycle";
import { Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// One coaching relationship from the coach's side — the web's
// /clients/relationship/[id] on a phone: where it stands and who moved it,
// the sessions it had, the conversation, the moves still possible, and its
// history. For a paused or past client this is the page: their training data
// stays behind is_active_coach_of(), so nothing of it is read here.

export default function CoachRelationship() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const c = t.coachProfile.coaching;
  const query = useQuery({ queryKey: ["coach-relationship", id], queryFn: () => api.coachRelationship(id) });
  const r = query.data?.relationship;
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}>
        <BackHeader label={c.relationship.back} />
        {!r ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : (
          <>
            <Card style={{ gap: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                {r.client_avatar ? <Image source={{ uri: r.client_avatar }} style={styles.avatar} /> : (
                  <View style={[styles.avatar, { backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }]}>
                    <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.accentInk }}>{[...r.client_name.trim()][0]?.toUpperCase() ?? "?"}</Text>
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: font.displayExtrabold, fontSize: 22, color: color.ink }}>{fill(c.relationship.title, { name: r.client_name })}</Text>
                  <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                    {r.status === "ended" && r.ended_at ? fill(c.period, { from: date(r.started_at), to: date(r.ended_at) }) : fill(c.since, { date: date(r.started_at) })}
                  </Text>
                </View>
              </View>
              <View style={{ marginTop: 10 }}><RelationshipPill status={r.status} /></View>
              {r.status === "ended" ? <Text style={[styles.line, { color: color.inkSoft }]}>{c.relationship.historyOnly}</Text> : null}
              {r.status === "paused" ? <Text style={[styles.line, { color: color.warn }]}>{c.relationship.pausedOnly}</Text> : null}
              {r.status === "paused" ? (
                <Text style={[styles.small, { color: color.inkFaint }]}>
                  {(r.paused_by_me ? c.pausedByYou : fill(c.pausedByOther, { name: r.client_name }))
                    + (r.pause_reason ? ` · ${(c.pauseReasons as Record<string, string>)[r.pause_reason] ?? r.pause_reason}` : "")}
                </Text>
              ) : null}
              {r.status === "ended" ? (
                <Text style={[styles.small, { color: color.inkFaint }]}>
                  {(r.ended_by_me ? c.endedByYou : r.ended_by_me === false ? fill(c.endedByOther, { name: r.client_name }) : "")
                    + (r.end_reason ? ` · ${(c.endReasons as Record<string, string>)[r.end_reason] ?? r.end_reason}` : "")}
                </Text>
              ) : null}
              <Text style={[styles.line, { color: color.inkSoft }]}>
                {fill(c.completedSessions, { n: r.completed_bookings }) + (r.next_booking_at ? ` · ${fill(c.clients.nextSession, { date: date(r.next_booking_at) })}` : "")}
              </Text>
              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                {r.status === "active" ? <Primary label={c.relationship.openClient} onPress={() => router.push({ pathname: "/coach/client/[id]", params: { id: r.client_id } })} /> : null}
                {r.conversation_id ? (
                  <Small label={c.message} onPress={() => router.push({ pathname: "/thread/[id]", params: { id: r.conversation_id! } })} style={{ height: 44, borderRadius: 14, paddingHorizontal: 16 }} />
                ) : null}
                <CoachingActions relationshipId={r.id} status={r.status} otherName={r.client_name}
                  invalidate={[["coach-relationship", id], ["coach-clients"], ["coach-dashboard"]]} />
              </View>
            </Card>
            {query.data && query.data.history.length > 0 ? (
              <Card style={{ gap: 12 }}>
                <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{c.history}</Text>
                <RelationshipTimeline events={query.data.history} otherName={r.client_name} />
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  line: { marginTop: 10, fontFamily: font.regular, fontSize: 13, lineHeight: 19 },
  small: { marginTop: 4, fontFamily: font.regular, fontSize: 12.5 },
});
