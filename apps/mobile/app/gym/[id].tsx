import type { GymDetailV1 } from "@healthapp/api/v1";
import { formatWeight, relevantOneRm } from "@healthapp/shared";
import { formatDecimal } from "@healthapp/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/role";
import { font, useTheme } from "@/lib/theme";

// One gym — the web's /gyms/[id] on a phone: where it is, Google's rating and
// hours, Make it my gym, then its records (per lift, by estimated 1RM or the
// heaviest lift, all time / year / month), its members and activity (null
// below three people), the busiest hours and days, and the coaches there.

export default function GymScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const s = t.gyms.stats;
  const [board, setBoard] = useState<{ lift?: string; kind?: GymDetailV1["kind"]; period?: GymDetailV1["period"] }>({});
  const query = useQuery({
    queryKey: ["gym", id, board],
    queryFn: () => api.gym(id, board),
    placeholderData: (prev) => prev,
  });
  const g = query.data;
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function makeHome() {
    setBusy(true);
    setFailed(false);
    try {
      const r = await api.saveGym(id, g?.on_boards ?? false);
      setFailed(!r.ok);
      await queryClient.invalidateQueries({ queryKey: ["gym", id] });
      void queryClient.invalidateQueries({ queryKey: ["gyms"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={s.back} />
        {!g ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <View style={{ gap: 6 }}>
              <T kind="title">{g.name}</T>
              <Text style={{ fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft }}>{g.where}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4 }}>
                <Text accessibilityRole="link" onPress={() => void Linking.openURL(g.map_url)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{`${s.openMap} ↗`}</Text>
                {g.rating != null ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{`★ ${fill(s.rating, { r: formatDecimal(g.rating, locale, { minDecimals: 1, maxDecimals: 1 }), n: nf.format(g.ratings_total ?? 0) })}`}</Text> : null}
                {g.open_state !== "unknown" ? (
                  <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: g.open_state === "open" ? color.accentInk : color.inkFaint }}>{`● ${g.open_state === "open" ? s.openNow : s.closedNow}`}</Text>
                ) : null}
              </View>
              <View style={{ marginTop: 4, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {g.is_home ? (
                  <View style={[styles.pill, { backgroundColor: color.accentSoft }]}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{s.isHome}</Text>
                  </View>
                ) : (
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => void makeHome()} style={[styles.pill, { backgroundColor: color.accent, opacity: busy ? 0.5 : 1 }]}>
                    <Text style={{ fontFamily: font.bold, fontSize: 13, color: color.accentFg }}>{s.setHome}</Text>
                  </Pressable>
                )}
                {g.phone ? (
                  <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`tel:${g.phone!.replace(/[^\d+]/g, "")}`)} style={[styles.pill, { backgroundColor: color.surface }]}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{`${s.call} · ${g.phone}`}</Text>
                  </Pressable>
                ) : null}
                {g.website ? (
                  <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(g.website!)} style={[styles.pill, { backgroundColor: color.surface }]}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{`${s.site} ↗`}</Text>
                  </Pressable>
                ) : null}
              </View>
              {failed ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{t.gyms.errors.generic}</Text> : null}
              {g.summary ? <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.inkSoft }}>{g.summary}</Text> : null}
              {g.closed_for_good ? (
                <View style={[styles.warn, { backgroundColor: color.warnSoft }]}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.warn }}>{s.closed}</Text>
                </View>
              ) : null}
            </View>

            <Records g={g} onPick={(patch) => setBoard((b) => ({ lift: g.lift ?? undefined, kind: g.kind, period: g.period, ...b, ...patch }))} />

            <View style={{ flexDirection: "row", gap: 10 }}>
              {[
                { k: s.members, v: g.members },
                { k: s.coaches, v: g.coaches_count },
                { k: s.onBoard, v: g.board },
              ].map((x) => (
                <Card key={x.k} style={{ flex: 1, alignItems: "center", gap: 2 }}>
                  <Text style={{ fontFamily: font.displayExtrabold, fontSize: 22, color: color.ink }}>{nf.format(x.v)}</Text>
                  <Text numberOfLines={2} style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint, textAlign: "center" }}>{x.k}</Text>
                </Card>
              ))}
            </View>

            {([["week", g.week], ["month", g.month]] as const).map(([k, v]) => (
              <Card key={k} style={{ gap: 4 }}>
                <T kind="label">{s[k]}</T>
                {v ? (
                  <>
                    <Text style={{ fontFamily: font.displayBold, fontSize: 19, color: color.ink }}>{fill(s.workouts, { n: nf.format(v.workouts) })}</Text>
                    <Text style={{ fontFamily: font.regular, fontSize: 14, color: color.inkSoft }}>{fill(s.athletes, { n: nf.format(v.athletes) })}</Text>
                    {"volume_kg" in v ? <Text style={{ fontFamily: font.regular, fontSize: 14, color: color.inkSoft }}>{fill(s.volume, { n: nf.format(v.volume_kg) })}</Text> : null}
                  </>
                ) : (
                  <>
                    <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.inkSoft }}>{s.notEnough}</Text>
                    <Text style={{ fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkFaint }}>{s.notEnoughHint}</Text>
                  </>
                )}
              </Card>
            ))}
            {g.my_month > 0 ? <T kind="soft">{fill(s.mine, { n: g.my_month })}</T> : null}

            {g.busy_hours && g.busy_days ? (
              <>
                <Card style={{ gap: 12 }}>
                  <T kind="label">{s.busyHours}</T>
                  <Bars values={g.busy_hours} labels={Array.from({ length: 24 }, (_, i) => String(i))} every={3} />
                  <T kind="faint">{s.last30}</T>
                </Card>
                <Card style={{ gap: 12 }}>
                  <T kind="label">{s.busyDays}</T>
                  <Bars values={g.busy_days} labels={s.days} />
                  <T kind="faint">{s.last30}</T>
                </Card>
              </>
            ) : null}

            {g.opening_hours.length > 0 ? (
              <Card style={{ gap: 4 }}>
                <T kind="label">{s.hours}</T>
                {g.opening_hours.map((line) => <Text key={line} style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{line}</Text>)}
              </Card>
            ) : null}

            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <T kind="label">{s.coachesHere}</T>
                {g.is_home ? <Text accessibilityRole="link" onPress={() => router.push("/leaderboards")} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{`${s.board} →`}</Text> : null}
              </View>
              {g.coaches.length === 0 ? <T kind="faint">{s.noCoaches}</T> : null}
              {g.coaches.map((c) => (
                <Pressable key={c.id} accessibilityRole="link" onPress={() => router.push({ pathname: "/coaches/[slug]", params: { slug: c.slug } })} style={[styles.person, { backgroundColor: color.bg }]}>
                  <Avatar name={c.display_name} url={c.avatar_url} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{c.display_name}</Text>
                    {c.headline ? <Text numberOfLines={1} style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{c.headline}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Gym records (components/gym-records.tsx): the lift chips, ranked by / period, the top ten. */
function Records({ g, onPick }: { g: GymDetailV1; onPick: (patch: { lift?: string; kind?: GymDetailV1["kind"]; period?: GymDetailV1["period"] }) => void }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const r = t.gyms.records;
  const unit = useMe().data?.data.weight_unit ?? "kg";
  const kg = (v: number) => formatWeight(v, unit, { locale });
  const valueOf = (row: GymDetailV1["records"][number]) => (g.kind === "weight" ? row.weight_kg : relevantOneRm(row.weight_kg, row.reps) ?? row.weight_kg);
  const seg = <K extends string>(keys: readonly K[], labels: Record<K, string>, on: K, pick: (k: K) => void) => (
    <View style={[styles.seg, { backgroundColor: color.bg }]}>
      {keys.map((k) => (
        <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: k === on }} onPress={() => pick(k)} style={[styles.segItem, k === on ? { backgroundColor: color.accent } : null]}>
          <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 12, color: k === on ? color.accentFg : color.inkSoft }}>{labels[k]}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <Card style={{ gap: 12 }}>
      <View>
        <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{r.title}</Text>
        <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkFaint }}>{r.intro}</Text>
      </View>
      {!g.on_boards ? (
        <Pressable accessibilityRole="link" onPress={() => router.navigate("/more")} style={[styles.optIn, { backgroundColor: color.bg }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{r.optInTitle}</Text>
          <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkFaint }}>{r.optInHint}</Text>
          <Text style={{ marginTop: 6, fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{`${r.optIn} →`}</Text>
        </Pressable>
      ) : null}
      {g.lifts.length === 0 && g.on_boards ? <T kind="soft">{r.noLifts}</T> : null}
      {g.lifts.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {g.lifts.map((l) => {
            const on = l.exercise_id === g.lift;
            return (
              <Pressable key={l.exercise_id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onPick({ lift: l.exercise_id })} style={[styles.chip, { backgroundColor: on ? color.accentSoft : color.bg }]}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentInk : color.inkSoft }}>{l.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {g.lift ? (
        <>
          {seg(["e1rm", "weight"] as const, r.kinds, g.kind, (kind) => onPick({ kind }))}
          {seg(["all", "year", "month"] as const, r.periods, g.period, (period) => onPick({ period }))}
          {g.records.length === 0 ? <T kind="soft">{r.empty}</T> : null}
          <View style={{ gap: 6 }}>
            {g.records.map((row) => (
              <View key={row.user_id} style={[styles.record, { backgroundColor: row.is_me ? color.accentSoft : color.bg }]}>
                <Text style={{ width: 26, textAlign: "center", fontFamily: font.displayExtrabold, fontSize: 16, color: row.rank <= 3 ? color.accentInk : color.inkFaint }}>{row.rank}</Text>
                <Avatar name={row.display_name} url={row.avatar_url} size={36} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{row.is_me ? r.you : row.display_name}</Text>
                  <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
                    {`${fill(r.set, { w: kg(row.weight_kg), r: row.reps })} · ${new Date(row.achieved_at).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
                  </Text>
                </View>
                <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.ink }}>{kg(valueOf(row))}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
      <Text style={{ fontFamily: font.regular, fontSize: 11.5, lineHeight: 17, color: color.inkFaint }}>{r.howItCounts}</Text>
    </Card>
  );
}

/** The busiest hours / days (gym-stats.tsx CountBars): one bar per slot, scaled to the busiest. */
function Bars({ values, labels, every = 1 }: { values: number[]; labels: readonly string[]; every?: number }) {
  const { color } = useTheme();
  const max = Math.max(1, ...values);
  return (
    <View>
      <View style={{ height: 72, flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
        {values.map((v, i) => (
          <View key={i} style={{ flex: 1, height: `${Math.max(4, (v / max) * 100)}%`, borderRadius: 3, backgroundColor: v === max ? color.accent : color.accentSoft }} />
        ))}
      </View>
      <View style={{ marginTop: 4, flexDirection: "row", gap: 2 }}>
        {values.map((_, i) => (
          <Text key={i} numberOfLines={1} style={{ flex: 1, textAlign: "center", fontFamily: font.regular, fontSize: 9.5, color: color.inkFaint }}>{i % every === 0 ? labels[i] : ""}</Text>
        ))}
      </View>
    </View>
  );
}

function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  const { color } = useTheme();
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (url) return <Image source={{ uri: url }} style={box} />;
  return (
    <View style={[box, { backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }]}>
      <Text style={{ fontFamily: font.displayBold, fontSize: size * 0.38, color: color.accentInk }}>{[...name.trim()][0]?.toUpperCase() ?? "?"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  pill: { height: 38, borderRadius: 19, paddingHorizontal: 14, justifyContent: "center" },
  warn: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  optIn: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  chip: { height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
  seg: { flexDirection: "row", borderRadius: 999, padding: 4, gap: 4 },
  segItem: { flex: 1, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  record: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 },
  person: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 },
});
