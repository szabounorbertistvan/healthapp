import type { CoachMarketplaceV1 } from "@healthapp/api/v1";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The coach's marketplace — the web's /marketplace on a phone: the profile's
// state, completeness and what is still missing, your public link to share,
// then requests, bookings, clients, messages, reviews and services, each
// leading to where it is managed.
// Editing the profile itself is /coach/profile.

/** The coach-profile editor (/settings/coach-profile on the web), at a step or at Verification. */
const profile = (params: { step?: string; focus?: string } = {}) => () => router.push({ pathname: "/coach/profile", params });

export default function CoachMarketplace() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const m = t.marketplace;
  const c = m.cards;
  const query = useQuery({ queryKey: ["coach-marketplace"], queryFn: api.coachMarketplace });
  const o = query.data;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.more} />
        <View>
          <T kind="title">{m.title}</T>
          <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{m.hint}</Text>
        </View>
        {!o ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : !o.has_profile ? (
          <Card style={{ gap: 8 }}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{t.coachBecome.title}</Text>
            <T kind="soft" style={{ lineHeight: 19 }}>{t.coachBecome.body}</T>
            <View style={{ marginTop: 6, alignSelf: "flex-start" }}>
              <Button height={42} label={t.coachBecome.button} onPress={profile()} />
            </View>
          </Card>
        ) : (
          <>
            <Profile o={o} />
            <Tile title={c.requests} onOpen={() => router.navigate("/inbox")}>
              {o.requests.pending + o.requests.accepted === 0 ? <Line>{c.requestsNone}</Line> : (
                <>
                  {o.requests.pending ? <Line tone={color.warn} strong>{fill(c.requestsPending, { n: o.requests.pending })}</Line> : null}
                  {o.requests.accepted ? <Line>{fill(c.requestsAccepted, { n: o.requests.accepted })}</Line> : null}
                </>
              )}
            </Tile>
            <Tile title={c.bookings} onOpen={() => router.push("/coach/bookings")}>
              {o.services.bookable === 0 && !o.bookings.next ? <Line>{c.bookingsNoBookable}</Line> : (
                <>
                  {o.bookings.next ? <Line strong>{fill(c.bookingsNext, { when: o.bookings.next.when, client: o.bookings.next.client, service: o.bookings.next.service })}</Line> : <Line>{c.bookingsNone}</Line>}
                  {o.bookings.pending ? <Line tone={color.warn} strong>{fill(c.bookingsPending, { n: o.bookings.pending })}</Line> : null}
                  {o.bookings.upcoming ? <Line>{fill(c.bookingsUpcoming, { n: o.bookings.upcoming })}</Line> : null}
                  {o.bookings.needs_outcome ? <Line>{fill(c.bookingsOutcome, { n: o.bookings.needs_outcome })}</Line> : null}
                </>
              )}
            </Tile>
            <Tile title={c.clients} onOpen={() => router.navigate("/clients")}>
              {o.clients.active + o.clients.invited + o.clients.paused === 0 ? <Line>{c.clientsNone}</Line> : (
                <>
                  <Line strong>{fill(c.clientsActive, { n: o.clients.active })}</Line>
                  {o.clients.paused ? <Line tone={color.warn}>{fill(c.clientsPaused, { n: o.clients.paused })}</Line> : null}
                  {o.clients.invited ? <Line>{fill(c.clientsInvited, { n: o.clients.invited })}</Line> : null}
                </>
              )}
            </Tile>
            <Tile title={c.messages} onOpen={() => router.navigate("/chats")}>
              <Line strong={o.messages.unread > 0}>{o.messages.unread ? fill(c.messagesUnread, { n: o.messages.unread, c: o.messages.conversations_unread }) : c.messagesNone}</Line>
            </Tile>
            <Tile title={c.reviews} onOpen={() => router.push("/coach/reviews")}>
              {o.reviews.count === 0 || o.reviews.avg === null ? <Line>{c.reviewsNone}</Line> : (
                <>
                  <Line strong>{fill(o.reviews.count === 1 ? c.reviewsOne : c.reviewsAvg, { avg: o.reviews.avg, n: o.reviews.count })}</Line>
                  {o.reviews.latest.map((r) => (
                    <Text key={r.id} numberOfLines={1} style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>
                      {`${"★".repeat(r.rating)} ${r.reviewer_name}${r.body ? ` — ${r.body}` : ""}`}
                    </Text>
                  ))}
                </>
              )}
            </Tile>
            <Tile title={c.services} onOpen={profile({ step: "5" })}>
              <Line>{o.services.active === 0 ? c.servicesNone : fill(c.servicesActive, { n: o.services.active, b: o.services.bookable })}</Line>
            </Tile>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** The profile card: state and its hint, completeness with the checklist, the next move, the public link. */
function Profile({ o }: { o: CoachMarketplaceV1 }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const m = t.marketplace;
  const state = o.state ?? "draft";
  const pct = o.completeness?.pct ?? 0;
  const tone = state === "published" ? { bg: color.accentSoft, ink: color.accentInk } : state === "suspended" ? { bg: color.riskSoft, ink: color.risk } : { bg: color.warnSoft, ink: color.warn };
  const primary = state === "draft" ? m.actions.continue : state === "ready" ? m.actions.submit : m.actions.edit;
  const revision = o.revision_status && o.revision_status in m.revisionHint ? m.revisionHint[o.revision_status as keyof typeof m.revisionHint] : null;
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <View style={[styles.state, { backgroundColor: tone.bg }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: tone.ink }}>{m.states[state]}</Text>
          </View>
          <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>{m.stateHints[state]}</Text>
          {revision ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.warn }}>{revision}</Text> : null}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ fontFamily: font.displayExtrabold, fontSize: 30, color: color.ink }}>{`${pct}%`}</Text>
        </View>
      </View>
      <View style={[styles.bar, { backgroundColor: color.bg }]}>
        <View style={{ width: `${pct}%`, height: "100%", borderRadius: 4, backgroundColor: color.accent }} />
      </View>
      <T kind="faint">{m.completenessHint}</T>
      <View style={{ gap: 6 }}>
        {(o.completeness?.items ?? []).map((item) => {
          const label = item.key === "bio" && !item.done && item.earned > 0 ? m.items.bioShort : (m.items as Record<string, string>)[item.key] ?? item.key;
          return (
            <View key={item.key} style={[styles.item, { backgroundColor: color.bg }]}>
              <View style={[styles.dot, { backgroundColor: item.done ? color.accent : item.required ? color.warnSoft : color.surface }]}>
                <Text style={{ fontFamily: font.bold, fontSize: 11, color: item.done ? color.accentFg : color.warn }}>{item.done ? "✓" : item.required ? "!" : ""}</Text>
              </View>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.regular, fontSize: 13.5, color: item.done ? color.ink : color.inkSoft }}>
                {label}
                {item.required && !item.done ? <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.warn }}>{`  ${m.required.toUpperCase()}`}</Text> : null}
              </Text>
              {!item.done && state !== "suspended" ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{fill(m.gain, { n: item.weight - item.earned })}</Text> : null}
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button height={42} label={primary} onPress={profile(state === "ready" ? { step: "6" } : {})} />
        {!o.verified ? (
          <Pressable accessibilityRole="link" onPress={profile({ focus: "verification" })} style={[styles.quiet, { backgroundColor: color.bg }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{m.actions.verify}</Text>
          </Pressable>
        ) : null}
      </View>
      {o.public_url ? (
        <Pressable accessibilityRole="button" onPress={() => void Share.share({ message: o.public_url! })} style={[styles.share, { backgroundColor: color.bg }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 11.5, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{m.shareTitle}</Text>
          <Text selectable style={{ marginTop: 4, fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{o.public_url}</Text>
          <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{m.shareHint}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function Tile({ title, onOpen, children }: { title: string; onOpen: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const { color } = useTheme();
  return (
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{title}</Text>
        <Text accessibilityRole="link" onPress={onOpen} style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{`${t.marketplace.cards.open} →`}</Text>
      </View>
      {children}
    </Card>
  );
}

function Line({ children, strong = false, tone }: { children: ReactNode; strong?: boolean; tone?: string }) {
  const { color } = useTheme();
  return <Text style={{ fontFamily: strong ? font.semibold : font.regular, fontSize: 13.5, lineHeight: 19, color: tone ?? (strong ? color.ink : color.inkSoft) }}>{children}</Text>;
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  state: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  bar: { height: 8, borderRadius: 4, overflow: "hidden" },
  item: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  dot: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  quiet: { height: 42, borderRadius: 16, paddingHorizontal: 16, justifyContent: "center" },
  share: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
});
