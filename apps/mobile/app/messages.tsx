import type { MyCoachingRelationshipV1, MyCoachingV1 } from "@healthapp/api/v1";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Section, Small } from "@/components/coach-profile-bits";
import { JoinCode } from "@/components/invite-code";
import { CoachingActions, RelationshipPill, RelationshipTimeline } from "@/components/coaching-lifecycle";
import { ThreadView } from "@/components/thread-view";
import { Card, Screen, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { alpha, font, space, useTheme } from "@/lib/theme";

// The client's coach — the web's /coach (app/(client)/coach/page.tsx) on a
// phone: the current coach (active or paused) with where things stand, the
// moves still possible (pause, resume, end) and the history, above the
// conversation; the past coaches as history, never mixed in. Without a current
// coach: an invite code, the way into Coach Discovery, the home gym's coaches.
// A database before the lifecycle still shows the active coach's thread.

const KEY = ["my-coaching"];

export default function Messages() {
  const { t } = useI18n();
  const { color } = useTheme();
  const query = useQuery({ queryKey: KEY, queryFn: api.myCoaching });
  const legacy = useOfflineQuery("coach-thread", ["coach-thread"], api.coachThread);
  const data = query.data;

  if (data?.current?.conversation_id) {
    return <ThreadView conversationId={data.current.conversation_id} back={t.mobile.tabs.more} header={<CurrentCoach data={data} current={data.current} />} />;
  }
  // before the lifecycle (or offline with a saved thread): the active coach's thread, as it always was
  const thread = legacy.data?.data;
  if ((data?.legacy || (!data && query.isError)) && thread?.conversation_id) {
    return <ThreadView conversationId={thread.conversation_id} back={t.mobile.tabs.more} />;
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
        >
          <BackHeader label={t.mobile.tabs.more} />
          {!data ? (
            query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
          ) : data.current ? (
            // a current coach without a conversation yet
            <>
              <CurrentCoach data={data} current={data.current} />
              <Card style={{ alignItems: "center", paddingVertical: 24 }}>
                <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink, textAlign: "center" }}>{t.clientApp.coach.noMessagesTitle}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft, textAlign: "center" }}>{t.clientApp.coach.noMessagesHint}</Text>
              </Card>
            </>
          ) : (
            <>
              <T kind="title">{t.common.nav.coach}</T>
              <NoCoach />
              <GymCoaches data={data} />
              <Past rows={data.past} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const date = (iso: string, locale: "en" | "ro") =>
  new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  const { color } = useTheme();
  return url ? <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} /> : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: size * 0.38, color: color.accentInk }}>{[...name.trim()][0]?.toUpperCase() ?? "?"}</Text>
    </View>
  );
}

/** The current coach: where it stands, the moves, the history (collapsed), then the past coaches. */
function CurrentCoach({ data, current }: { data: MyCoachingV1; current: MyCoachingRelationshipV1 }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const c = t.coachProfile.coaching;
  const [showHistory, setShowHistory] = useState(false);
  return (
    <View style={{ gap: 14 }}>
      <View style={[styles.card, { backgroundColor: color.surface }]}>
        <Section>{c.current}</Section>
        <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar name={current.coach_name} url={current.coach_avatar} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: font.displayExtrabold, fontSize: 22, color: color.ink }}>{current.coach_name}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
              {fill(c.since, { date: date(current.started_at, locale) }) + (current.status === "paused" && current.paused_at ? ` · ${fill(c.pausedSince, { date: date(current.paused_at, locale) })}` : "")}
            </Text>
          </View>
          <RelationshipPill status={current.status} />
        </View>
        {current.status === "paused" ? (
          <View style={{ marginTop: 12, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: color.warnSoft }}>
            <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.warn }}>
              {`${c.pausedNote} ${current.paused_by_me ? c.pausedByYou : fill(c.pausedByOther, { name: current.coach_name })}`
                + (current.pause_reason ? ` · ${(c.pauseReasons as Record<string, string>)[current.pause_reason] ?? current.pause_reason}` : "")}
            </Text>
          </View>
        ) : null}
        <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {current.coach_slug ? (
            <Small label={c.book} onPress={() => router.push({ pathname: "/coaches/[slug]", params: { slug: current.coach_slug! } })} style={{ height: 44, borderRadius: 14, paddingHorizontal: 16 }} />
          ) : null}
          <CoachingActions relationshipId={current.id} status={current.status} otherName={current.coach_name} invalidate={[KEY, ["coach-thread"], ["today"]]} />
        </View>
        {data.history.length > 1 ? (
          <View style={{ marginTop: 14 }}>
            <Text accessibilityRole="button" accessibilityState={{ expanded: showHistory }} onPress={() => setShowHistory((v) => !v)}
              style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{`${showHistory ? "▾" : "▸"} ${c.history}`}</Text>
            {showHistory ? <View style={{ marginTop: 10 }}><RelationshipTimeline events={data.history} otherName={current.coach_name} /></View> : null}
          </View>
        ) : null}
      </View>
      <Past rows={data.past} />
    </View>
  );
}

/** Coaching that has ended (PastCoachRow): message, review, start again. */
function Past({ rows }: { rows: MyCoachingRelationshipV1[] }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const c = t.coachProfile.coaching;
  if (rows.length === 0) return null;
  const link = { fontFamily: font.semibold, fontSize: 13, color: color.accentInk } as const;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{c.past}</Text>
      <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.inkSoft }}>{c.pastHint}</Text>
      {rows.map((r) => (
        <View key={r.id} style={[styles.card, { backgroundColor: color.surface, padding: 14 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Avatar name={r.coach_name} url={r.coach_avatar} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{r.coach_name}</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                {fill(c.period, { from: date(r.started_at, locale), to: r.ended_at ? date(r.ended_at, locale) : "—" })
                  + (r.end_reason ? ` · ${(c.endReasons as Record<string, string>)[r.end_reason] ?? r.end_reason}` : "")}
              </Text>
            </View>
            <RelationshipPill status={r.status} />
          </View>
          <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>
            {fill(c.completedSessions, { n: r.completed_bookings }) + (r.my_review ? ` · ${fill(c.yourReview, { rating: r.my_review.rating })}` : "")}
          </Text>
          <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {r.conversation_id ? <Text accessibilityRole="link" style={link} onPress={() => router.push({ pathname: "/thread/[id]", params: { id: r.conversation_id! } })}>{c.message}</Text> : null}
            {/* the review form is on the coach's page */}
            {r.coach_slug && !r.my_review ? <Text accessibilityRole="link" style={link} onPress={() => router.push({ pathname: "/coaches/[slug]", params: { slug: r.coach_slug! } })}>{c.review}</Text> : null}
            {r.coach_slug ? <Text accessibilityRole="link" style={link} onPress={() => router.push({ pathname: "/coaches/[slug]", params: { slug: r.coach_slug! } })}>{c.startNew}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** No current coach: an invite code (JoinCoach) or the directory. */
function NoCoach() {
  const { t } = useI18n();
  const { color } = useTheme();
  const w = t.clientApp.welcome;
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{t.clientApp.coach.noCoachTitle}</Text>
      <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{w.withCoachBody}</Text>
      {!open ? (
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={[styles.wide, { backgroundColor: color.bg }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.inkSoft }}>{w.haveCode}</Text>
        </Pressable>
      ) : (
        <JoinCode autoFocus />
      )}
      <Pressable accessibilityRole="link" onPress={() => router.push("/coaches")} style={[styles.wide, { backgroundColor: color.bg, alignSelf: "flex-start", paddingHorizontal: 20 }]}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{`${t.coachProfile.saved.emptyCta} →`}</Text>
      </Pressable>
    </Card>
  );
}

/** The home gym's coaches (GymCoachesCard); contacting one happens on their page. */
function GymCoaches({ data }: { data: MyCoachingV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const f = t.gyms.find;
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{data.gym ? fill(f.title, { gym: data.gym.name }) : f.noGymTitle}</Text>
      {!data.gym ? (
        <>
          <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{f.noGym}</Text>
          <View style={{ alignSelf: "flex-start" }}><Small label={f.pickGym} onPress={() => router.push("/more")} /></View>
        </>
      ) : data.gym_coaches.length === 0 ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{f.empty}</Text>
      ) : data.gym_coaches.map((c) => (
        <Pressable key={c.slug} accessibilityRole="link" onPress={() => router.push({ pathname: "/coaches/[slug]", params: { slug: c.slug } })}
          style={({ pressed }) => [styles.coach, { backgroundColor: pressed ? alpha(color.accentSoft, 0.4) : color.bg }]}>
          <Avatar name={c.display_name} url={c.avatar_url} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{c.display_name}</Text>
            {c.headline ? <Text numberOfLines={1} style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{c.headline}</Text> : null}
            {!c.accepting_clients ? <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{f.notAccepting}</Text> : null}
          </View>
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{f.profile}</Text>
        </Pressable>
      ))}
      <Text accessibilityRole="link" onPress={() => router.push("/coaches/requests")} style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>
        {t.coachProfile.requests.mine.title}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: 14, paddingBottom: 48 },
  card: { borderRadius: 24, padding: 18 },
  wide: { height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  coach: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 12 },
});
