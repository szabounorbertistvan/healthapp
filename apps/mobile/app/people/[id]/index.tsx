import type { PersonPageV1 } from "@healthapp/api/v1";
import { followState, isAchievementRarity, summarizeAchievements } from "@healthapp/shared";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BADGE_GLYPH } from "@/components/badge-glyph";
import { ModerationMenu } from "@/components/moderation";
import { Avatar, FollowButton } from "@/components/people";
import { PostCard } from "@/components/post-card";
import { RoutineCardView } from "@/components/routine-card";
import { ShareToFeed } from "@/components/share-feed";
import { NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// A person's profile — the web's /people/[id] on a phone, top to bottom like
// the big apps: avatar, name, Posts / Followers / Following; the follow button
// (or Edit profile on your own) and the ••• menu; bio, "Followed by…",
// activity and the Fitness Score as far as their privacy lets this reader see;
// then the tabs Posts · Achievements · Programs, each only when there is
// something behind it. Every number is the server's (social_profile).

const FLAME = "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z";
const LOCK = "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z";
const FILTERS = ["all", "workouts", "prs", "challenges", "achievements"] as const;
type Filter = (typeof FILTERS)[number];
type Tab = "posts" | "achievements" | "programs";

export default function Person() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const s = t.common.social;
  const st = t.common.streaks;
  const [tab, setTab] = useState<Tab>("posts");
  const [filter, setFilter] = useState<Filter>("all");
  const head = useQuery({ queryKey: ["person", id, tab], queryFn: () => api.person(id, `tab=${tab}`), placeholderData: (p) => p });
  const posts = useInfiniteQuery({
    queryKey: ["person", id, "posts", filter],
    enabled: tab === "posts",
    queryFn: ({ pageParam }) => api.person(id, new URLSearchParams({ tab: "posts", ...(filter !== "all" ? { type: filter } : {}), ...(pageParam ? { before: pageParam } : {}) }).toString()),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.posts?.next_cursor ?? null,
  });
  const d = head.data;
  const p = d?.profile;
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["person", id] }); };

  if (!d || !p) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 16 }}>
        <BackHeader label={s.feed} />
        {head.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />}
      </SafeAreaView>
    );
  }

  const relation = followState(p);
  const relationLabel = relation === "mutual" ? s.relationMutual : relation === "follows_you" ? s.relationFollowsYou : null;
  const action = p.me ? (
    <Pressable accessibilityRole="link" onPress={() => router.push("/more")} style={[styles.edit, { borderColor: color.line, backgroundColor: color.surface }]}>
      <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{s.editProfile}</Text>
    </Pressable>
  ) : (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {p.blocked ? null : <FollowButton userId={p.id} following={p.is_following} followsMe={p.follows_me} />}
      <ModerationMenu target={{ userId: p.id, name: p.name }} muted={p.muted} blocked={p.blocked} place="profile" onChanged={refresh} />
    </View>
  );

  // blocked by you: the page opens only so you can unblock; nothing of them is shown
  if (p.blocked) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body}>
          <BackHeader label={s.feed} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Avatar name={p.name} url={p.avatar_url} size={80} />
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.displayExtrabold, fontSize: 21, color: color.ink }}>{p.name}</Text>
            {action}
          </View>
          <View style={[styles.box, { backgroundColor: color.surface, borderColor: color.line }]}>
            <Text style={{ textAlign: "center", fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{fill(t.common.moderation.blockedProfile, { name: p.name })}</Text>
            <Text style={{ marginTop: 4, textAlign: "center", fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{t.common.moderation.blockedProfileHint}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "posts", label: s.tabPosts },
    ...(p.stats_visible ? [{ key: "achievements" as const, label: s.tabAchievements }] : []),
    ...(d.routines.length > 0 ? [{ key: "programs" as const, label: s.publicPrograms }] : []),
  ];
  const activity = p.stats_visible
    ? [p.workouts !== null ? `${nf.format(p.workouts)} ${s.workouts.toLowerCase()}` : null, p.prs !== null ? `${nf.format(p.prs)} ${s.prs}` : null,
      p.challenges !== null ? `${nf.format(p.challenges)} ${s.challenges.toLowerCase()}` : null].filter((x): x is string => Boolean(x))
    : [];
  const counts = [
    { label: s.postsCount, value: p.posts, list: null },
    { label: s.followers, value: p.followers, list: "followers" as const },
    { label: s.followingCount, value: p.following, list: "following" as const },
  ];
  const filterLabel: Record<Filter, string> = { all: s.feedAll, workouts: s.tabWorkouts, prs: s.tabPrs, challenges: s.tabChallenges, achievements: s.tabAchievements };
  const postItems = posts.data?.pages.flatMap((x) => x.posts?.items ?? []) ?? [];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={head.isRefetching} onRefresh={() => { void head.refetch(); void posts.refetch(); }} tintColor={color.accent} />}>
        <BackHeader label={s.feed} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Avatar name={p.name} url={p.avatar_url} size={80} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: font.displayExtrabold, fontSize: 21, color: color.ink }}>{p.name}</Text>
            <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>
              {[p.username && p.username !== p.name ? `@${p.username}` : null, p.city].filter(Boolean).join(" · ")}
            </Text>
            <View style={{ marginTop: 8, flexDirection: "row", gap: 20 }}>
              {counts.map((c) => (
                <Pressable key={c.label} accessibilityRole={c.list ? "link" : undefined} disabled={!c.list}
                  onPress={() => c.list && router.push({ pathname: "/people/[id]/[list]", params: { id: p.id, list: c.list } })} style={{ minHeight: 44, justifyContent: "center" }}>
                  <Text style={{ fontFamily: font.bold, fontSize: 16, color: color.ink }}>{nf.format(c.value)}</Text>
                  <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          {action}
          {relationLabel ? <View style={[styles.relation, { backgroundColor: color.accentSoft }]}><Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.accentInk }}>{relationLabel}</Text></View> : null}
        </View>
        {p.bio ? <Text style={{ fontFamily: font.regular, fontSize: 14, lineHeight: 21, color: color.inkSoft }}>{p.bio}</Text> : null}
        {d.mutuals.total > 0 && d.mutuals.people[0] ? (
          <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/people/[id]/[list]", params: { id: p.id, list: "followers" } })} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flexDirection: "row" }}>
              {d.mutuals.people.slice(0, 3).map((m, i) => <View key={m.id} style={{ marginLeft: i ? -8 : 0, borderRadius: 13, borderWidth: 2, borderColor: color.bg }}><Avatar name={m.name} url={m.avatar_url} size={22} /></View>)}
            </View>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
              {d.mutuals.total === 1 ? fill(s.mutualsOne, { name: d.mutuals.people[0].name }) : fill(s.mutualsMany, { name: d.mutuals.people[0].name, count: d.mutuals.total - 1 })}
            </Text>
          </Pressable>
        ) : null}
        {!p.stats_visible ? (
          // said plainly rather than shown as zeros: zeros would be a lie about someone who keeps it to themselves
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <NavIcon d={LOCK} size={16} color={color.inkFaint} />
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{fill(s.statsHiddenPrivate, { name: p.name })}</Text>
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            {activity.length > 0 ? <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{activity.join(" · ")}</Text> : null}
            {(p.streak_days ?? 0) > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <NavIcon d={FLAME} size={16} color={color.accent} />
                <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{p.streak_days === 1 ? st.dayStreakOne : fill(st.dayStreak, { count: p.streak_days ?? 0 })}</Text>
              </View>
            ) : null}
          </View>
        )}
        {p.fitness_score !== null ? (
          <View style={[styles.score, { backgroundColor: color.accent }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.accentFg, opacity: 0.75 }}>{s.fitnessScore}</Text>
            <Text style={{ fontFamily: font.displayExtrabold, fontSize: 17, color: color.accentFg }}>{p.fitness_score}</Text>
            {p.fitness_score_at ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.accentFg, opacity: 0.7 }}>{fill(s.fitnessScorePublished, { date: df.format(new Date(p.fitness_score_at)) })}</Text> : null}
          </View>
        ) : null}

        <View accessibilityRole="tablist" style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: color.line }}>
          {tabs.map((x) => (
            <Pressable key={x.key} accessibilityRole="tab" accessibilityState={{ selected: tab === x.key }} onPress={() => setTab(x.key)}
              style={{ flex: 1, height: 48, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: tab === x.key ? color.accent : "transparent", marginBottom: -1 }}>
              <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 13.5, color: tab === x.key ? color.ink : color.inkFaint }}>{x.label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === "posts" ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {FILTERS.map((f) => (
                <Pressable key={f} accessibilityRole="tab" accessibilityState={{ selected: filter === f }} onPress={() => setFilter(f)}
                  style={[styles.filter, filter === f ? { backgroundColor: color.accent } : { backgroundColor: color.surface, borderWidth: 1, borderColor: color.line }]}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: filter === f ? color.accentFg : color.inkSoft }}>{filterLabel[f]}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {!posts.data ? <ActivityIndicator color={color.accent} /> : postItems.length === 0 ? (
              <View style={[styles.box, { backgroundColor: color.surface, borderColor: color.line }]}>
                <Text style={{ textAlign: "center", fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft }}>{filter !== "all" ? s.noPostsOfType : s.noPostsYet}</Text>
              </View>
            ) : postItems.map((post) => <PostCard key={post.id} post={post} />)}
            {posts.hasNextPage ? (
              <Pressable accessibilityRole="button" disabled={posts.isFetchingNextPage} onPress={() => void posts.fetchNextPage()} style={[styles.more, { borderColor: color.line, backgroundColor: color.surface }]}>
                <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{s.loadMore}</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {tab === "achievements" ? <Badges badges={d.badges} mine={p.me} /> : null}
        {tab === "programs" ? d.routines.map((card) => <RoutineCardView key={card.id} card={card} />) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** The achievements tab (BadgeShelf): the categories with their counts, then each badge; the owner shares theirs. */
function Badges({ badges, mine }: { badges: PersonPageV1["badges"]; mine: boolean }) {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  const a = t.common.achievements;
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (badges.length === 0) {
    return (
      <View style={[styles.box, { backgroundColor: color.surface, borderColor: color.line }]}>
        <Text style={{ textAlign: "center", fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft }}>{mine ? s.noAchievementsMine : s.noAchievements}</Text>
      </View>
    );
  }
  const byCategory = summarizeAchievements(badges.map((b) => ({ ...b, earned: true }))).byCategory;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {byCategory.map((c) => (
          <View key={c.category} style={[styles.cat, { borderColor: color.line, backgroundColor: color.surface }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>
              {`${(a.categories as Record<string, string>)[c.category] ?? c.category} `}<Text style={{ color: color.inkFaint }}>{c.earned}</Text>
            </Text>
          </View>
        ))}
        {mine ? <Text accessibilityRole="link" onPress={() => router.push("/achievements")} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{a.seeAll}</Text> : null}
      </View>
      {badges.map((b) => (
        <View key={b.slug} style={[styles.badge, { backgroundColor: color.surface }]}>
          <View style={[styles.glyph, { backgroundColor: color.accent }]}>
            <NavIcon d={BADGE_GLYPH[b.icon ?? ""] ?? BADGE_GLYPH.trophy!} size={20} color={color.accentFg} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            {/* the owner's badge opens its page; nobody else's — that page is the owner's progress */}
            <Text numberOfLines={1} accessibilityRole={mine ? "link" : undefined} onPress={mine ? () => router.push({ pathname: "/achievement/[slug]", params: { slug: b.slug } }) : undefined}
              style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{locale === "ro" ? b.name_ro : b.name_en}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>
              {[isAchievementRarity(b.rarity) ? a.rarities[b.rarity] : null, df.format(new Date(b.awarded_at))].filter(Boolean).join(" · ")}
            </Text>
            {mine ? <ShareToFeed shared={b.shared} label={s.shareAchievement} share={(v) => api.shareAchievement(b.slug, v)} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  edit: { height: 40, minWidth: 136, borderRadius: 20, borderWidth: 1, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  relation: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  score: { alignSelf: "flex-start", flexDirection: "row", alignItems: "baseline", gap: 8, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  box: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 20, paddingVertical: 32 },
  filter: { height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
  more: { height: 44, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  cat: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  badge: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  glyph: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
