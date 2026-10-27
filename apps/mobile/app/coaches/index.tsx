import type { CoachCardV1 } from "@healthapp/api/v1";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// Find a coach — the web's /coaches on a phone: search, online / in person, a
// specialization, "include coaches not taking clients", the cards in
// coach_ranked() order a page at a time, and Saved, the private shortlist.
// Each card opens the coach's page (app/coaches/[slug].tsx). ?landing=<slug> is
// the web's /coaches/<city | specialization | country> listing, ?city= one city.

type View_ = "all" | "saved";

export default function Coaches() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const d = t.coachProfile.discovery;
  const params0 = useLocalSearchParams<{ landing?: string; city?: string; spec?: string }>();
  const [view, setView] = useState<View_>("all");
  const [landing, setLanding] = useState(params0.landing ?? "");
  const [city, setCity] = useState(params0.city ?? "");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [online, setOnline] = useState(false);
  const [inPerson, setInPerson] = useState(false);
  const [spec, setSpec] = useState(params0.spec ?? "");
  const [includeFull, setIncludeFull] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 350);
    return () => clearTimeout(id);
  }, [typed]);
  const params = (page: number) => {
    const p = new URLSearchParams({ page: String(page) });
    if (view === "saved") p.set("saved", "1");
    if (q) p.set("q", q);
    if (online) p.set("online", "1");
    if (inPerson) p.set("in_person", "1");
    if (spec) p.set("spec", spec);
    if (landing) p.set("landing", landing);
    if (city) p.set("city", city);
    if (includeFull) p.set("all", "1");
    return p.toString();
  };
  const query = useInfiniteQuery({
    queryKey: ["coaches", view, q, online, inPerson, spec, includeFull, landing, city],
    queryFn: ({ pageParam }) => api.coaches(params(pageParam)),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.has_more ? pages.length + 1 : undefined),
  });
  const first = query.data?.pages[0];
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const specs = first?.specializations ?? [];
  const cities = (first?.cities ?? []).slice(0, 12);
  const land = view === "all" ? first?.landing ?? null : null;
  const chip = (on: boolean) => [styles.chip, { backgroundColor: on ? color.accent : color.surface }];
  const ink = (on: boolean) => ({ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentFg : color.inkSoft });

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.more} />
        <View>
          {land ? (
            <Text accessibilityRole="link" onPress={() => setLanding("")} style={{ marginBottom: 6, fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{`← ${d.backToDiscover}`}</Text>
          ) : null}
          <T kind="title">{land ? land.title : d.title}</T>
          <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>{land ? land.intro : d.subtitle}</Text>
          {/* the web's header links (coaches/layout.tsx): the reader's requests and bookings */}
          <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            <Text accessibilityRole="link" onPress={() => router.push("/coaches/requests")} style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{t.coachProfile.requests.mine.title}</Text>
            <Text accessibilityRole="link" onPress={() => router.push("/bookings")} style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{t.coachProfile.bookings.mine.title}</Text>
          </View>
        </View>
        <View style={[styles.seg, { backgroundColor: color.surface }]}>
          {(["all", "saved"] as const).map((k) => (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: k === view }} onPress={() => setView(k)} style={[styles.segItem, k === view ? { backgroundColor: color.accent } : null]}>
              <Text style={ink(k === view)}>{k === "all" ? d.explore : t.coachProfile.saved.title}</Text>
            </Pressable>
          ))}
        </View>
        {view === "all" ? (
          <>
            <TextInput value={typed} onChangeText={setTyped} autoCorrect={false} placeholder={d.searchPlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={d.searchLabel} style={[styles.search, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: online }} onPress={() => setOnline((v) => !v)} style={chip(online)}><Text style={ink(online)}>{d.online}</Text></Pressable>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: inPerson }} onPress={() => setInPerson((v) => !v)} style={chip(inPerson)}><Text style={ink(inPerson)}>{d.inPerson}</Text></Pressable>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: includeFull }} onPress={() => setIncludeFull((v) => !v)} style={chip(includeFull)}><Text style={ink(includeFull)}>{d.includeFull}</Text></Pressable>
            </ScrollView>
            {cities.length > 0 && land?.kind !== "city" ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
                <Pressable accessibilityRole="radio" accessibilityState={{ checked: !city }} onPress={() => setCity("")} style={chip(!city)}><Text style={ink(!city)}>{d.anyCity}</Text></Pressable>
                {cities.map((c) => (
                  <Pressable key={c.slug} accessibilityRole="radio" accessibilityState={{ checked: c.slug === city }} onPress={() => setCity(c.slug === city ? "" : c.slug)} style={chip(c.slug === city)}>
                    <Text style={ink(c.slug === city)}>{`${c.name} · ${c.coaches}`}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            {specs.length > 0 && land?.kind !== "specialization" ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
                {specs.map((s) => (
                  <Pressable key={s.slug} accessibilityRole="radio" accessibilityState={{ checked: s.slug === spec }} onPress={() => setSpec(s.slug === spec ? "" : s.slug)} style={chip(s.slug === spec)}>
                    <Text style={ink(s.slug === spec)}>{`${s.name} · ${s.coaches}`}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </>
        ) : null}
        {first ? <T kind="faint">{first.total === 1 ? d.countOne : fill(d.count, { n: first.total })}</T> : null}
        {query.isLoading ? <ActivityIndicator color={color.accent} /> : query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : items.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: color.surface }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink, textAlign: "center" }}>{view === "saved" ? t.coachProfile.saved.emptyTitle : d.noMatch}</Text>
            <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft, textAlign: "center" }}>{view === "saved" ? t.coachProfile.saved.emptyHint : q ? fill(d.noSearchHint, { q }) : d.noMatchHint}</Text>
          </View>
        ) : items.map((c) => <CoachCard key={c.slug} c={c} />)}
        {query.hasNextPage ? (
          <Pressable accessibilityRole="button" disabled={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} style={[styles.more, { borderColor: color.line, opacity: query.isFetchingNextPage ? 0.5 : 1 }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{d.loadMore}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function CoachCard({ c }: { c: CoachCardV1 }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const d = t.coachProfile.discovery;
  const p = t.coachProfile.publicPage;
  const [saved, setSaved] = useState(c.saved);
  const avg = c.rating ? new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(c.rating.average) : null;
  const facts = [
    c.formats.map((f) => (f === "online" ? d.online : d.inPerson)).join(" · "),
    c.city,
    c.years ? fill(p.yearsShort, { n: c.years }) : null,
  ].filter(Boolean).join(" · ");

  async function toggle() {
    if (!c.profile_id || saved === null) return;
    const before = saved;
    setSaved(!before);
    const r = await api.coachAct({ op: "save", profileId: c.profile_id, saved: before }).catch(() => null);
    if (!r?.ok) setSaved(before);
    else void queryClient.invalidateQueries({ queryKey: ["coaches", "saved"] });
  }

  return (
    <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/coaches/[slug]", params: { slug: c.slug } })} style={[styles.card, { backgroundColor: color.surface }]}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        {c.avatar_url ? <Image source={{ uri: c.avatar_url }} style={styles.avatar} /> : (
          <View style={[styles.avatar, { backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 20, color: color.accentInk }}>{[...c.name.trim()][0]?.toUpperCase() ?? "?"}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: font.displayBold, fontSize: 16.5, color: color.ink }}>{c.name}</Text>
            {c.verified ? <Text style={{ fontFamily: font.bold, fontSize: 12, color: color.accentInk }}>✓</Text> : null}
          </View>
          {c.headline ? <Text numberOfLines={2} style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{c.headline}</Text> : null}
          {facts ? <Text numberOfLines={1} style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{facts}</Text> : null}
        </View>
        {saved !== null ? (
          <Pressable accessibilityRole="button" accessibilityState={{ selected: saved }} accessibilityLabel={t.coachProfile.saved.title} onPress={() => void toggle()} hitSlop={8}>
            <Text style={{ fontSize: 18, color: saved ? color.accentInk : color.inkFaint }}>{saved ? "★" : "☆"}</Text>
          </Pressable>
        ) : null}
      </View>
      {c.specializations.length > 0 ? (
        <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {c.specializations.slice(0, 3).map((s) => (
            <View key={s} style={[styles.tag, { backgroundColor: color.bg }]}><Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.inkSoft }}>{s}</Text></View>
          ))}
          {c.more_specializations > 0 ? <Text style={{ alignSelf: "center", fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{`+${c.more_specializations}`}</Text> : null}
        </View>
      ) : null}
      <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        {avg && c.rating ? <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.ink }}>{`${avg} ★ · ${c.rating.count} ${c.rating.count === 1 ? t.coachProfile.reviews.one : t.coachProfile.reviews.many}`}</Text> : null}
        {c.starting_price ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{fill(d.priceFrom, { price: c.starting_price })}</Text> : null}
        {c.available_soon ? <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.accentInk }}>{d.availableChip}</Text> : null}
        <Text style={{ marginLeft: "auto", fontFamily: font.semibold, fontSize: 12, color: c.accepting ? color.accentInk : color.inkFaint }}>{c.accepting ? p.accepting : p.notAccepting}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 12 },
  seg: { flexDirection: "row", borderRadius: 999, padding: 4, gap: 4 },
  segItem: { flex: 1, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  search: { height: 46, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14 },
  chip: { height: 34, borderRadius: 17, paddingHorizontal: 12, justifyContent: "center" },
  empty: { borderRadius: 24, paddingHorizontal: 24, paddingVertical: 36 },
  card: { borderRadius: 22, padding: 16 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  more: { height: 44, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
});
