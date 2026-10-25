import type { FeedPostV1 } from "@healthapp/api/v1";
import { isAchievementRarity, postPhotoOf, type ReactionType } from "@healthapp/shared";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { NavIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { alpha, font, useTheme } from "@/lib/theme";

// One post, as the web's components/social.tsx PostCard draws it on a phone:
// the author and when, the caption, the post itself by kind, then kudos / love
// and the comments. The feed and a post's page both use it.

const DUMBBELL = "M6.5 6.5v11M9.5 8.5v7M14.5 8.5v7M17.5 6.5v11M9.5 12h5";
const TROPHY = "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4";
const FLAME = "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z";
const TREND = "M4 17l5-5 3 3 7-7M15 8h5v5";
const BOOKMARK = "M6 3h12v18l-6-4.5L6 21z";
const COMMENT = "M4 5h16v11H9l-5 4z";
const REACTION: Record<ReactionType, string> = { kudos: "💪", love: "🍑" };

export const absolute = (url: string) => (/^https?:\/\//.test(url) ? url : `${config.apiUrl}${url}`);

/** social_react(): the same one again takes it back, the other one replaces it. */
export function flipReaction(p: FeedPostV1, type: ReactionType): FeedPostV1 {
  const next = p.my_reaction === type ? null : type;
  const count = (r: ReactionType) => (p[`${r}_count`] as number) + (next === r ? 1 : 0) - (p.my_reaction === r ? 1 : 0);
  return { ...p, my_reaction: next, kudos_count: count("kudos"), love_count: count("love") };
}

/** social-chrome.tsx useSocialFormat().when: "2m ago", "1h ago", "Yesterday", "3d ago", then the date. */
export function useWhen() {
  const { t, fill, locale } = useI18n();
  const s = t.common.social;
  const dtf = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
    if (!Number.isFinite(ms) || ms < MIN) return s.justNow;
    if (ms < HOUR) return fill(s.minutesAgo, { m: Math.floor(ms / MIN) });
    if (ms < DAY) return fill(s.hoursAgo, { h: Math.floor(ms / HOUR) });
    if (ms < 2 * DAY) return s.yesterday;
    if (ms < 7 * DAY) return fill(s.daysAgo, { d: Math.floor(ms / DAY) });
    return dtf.format(new Date(iso));
  };
}

/** removeOnUnsave: on Saved, unsaving takes the card away at once (and brings it back if that fails). */
export function PostCard({ post: initial, link = true, removeOnUnsave = false }: { post: FeedPostV1; link?: boolean; removeOnUnsave?: boolean }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const when = useWhen();
  const [post, setPost] = useState(initial);
  useEffect(() => setPost(initial), [initial]);
  const s = t.common.social;
  const [error, setError] = useState<string | null>(null);
  const photo = post.media.find((m) => m.kind === "image") ?? null;
  const legacy = photo ? null : postPhotoOf(post.payload);
  const picture = photo ? { url: absolute(photo.url), ratio: photo.width / photo.height } : legacy ? { url: absolute(legacy.url), ratio: legacy.width && legacy.height ? legacy.width / legacy.height : 1 } : null;

  async function toggleSave() {
    setError(null);
    const next = !post.saved;
    setPost((p) => ({ ...p, saved: next }));
    try {
      const r = await api.savePost(post.id, next);
      if (!r.ok) throw new Error();
    } catch {
      setPost((p) => ({ ...p, saved: !next }));
      setError(s.saveError);
    }
  }

  if (removeOnUnsave && !post.saved) return null;

  async function press(type: ReactionType) {
    setError(null);
    // Optimistic, as the web's card: the count moves at once and settles on the server's answer.
    const before = post;
    setPost(flipReaction(post, type));
    try {
      const r = await api.react(post.id, type);
      if (!r.ok) throw new Error(r.message);
    } catch (e) {
      setPost(before);
      setError(e instanceof Error && e.message ? e.message : s.kudosError);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: color.surface }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 14 }}>
        {post.author_avatar ? (
          <Image source={{ uri: post.author_avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 15, color: color.accentInk }}>{[...post.author_name.trim()][0]?.toUpperCase() ?? "?"}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{post.author_name}</Text>
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{when(post.created_at)}</Text>
        </View>
      </View>

      {post.text ? <Text style={{ paddingHorizontal: 16, paddingTop: 10, fontFamily: font.regular, fontSize: 14, lineHeight: 21, color: color.ink }}>{post.text}</Text> : null}

      {picture && post.payload?.kind !== "workout" ? (
        <Image source={{ uri: picture.url }} style={{ marginTop: 12, width: "100%", aspectRatio: Math.max(0.6, Math.min(picture.ratio, 1.9)) }} resizeMode="cover" />
      ) : null}
      <View style={{ marginTop: 12 }}>
        <PostBody post={post} picture={post.payload?.kind === "workout" ? picture : null} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 }}>
        {(["kudos", "love"] as const).map((type) => {
          const on = post.my_reaction === type;
          const count = post[`${type}_count`];
          return (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={on ? s.removeReaction : s.giveReaction[type]}
              disabled={post.mine}
              onPress={() => void press(type)}
              style={[styles.reaction, on ? { backgroundColor: color.accentSoft } : null]}
            >
              <Text style={{ fontSize: 20, opacity: on || post.mine ? 1 : 0.55 }}>{REACTION[type]}</Text>
              {count > 0 ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: on ? color.accentInk : color.inkSoft }}>{count}</Text> : null}
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="link" disabled={!link} onPress={() => router.push({ pathname: "/post/[id]", params: { id: post.id } })} style={styles.reaction}>
          <NavIcon d={COMMENT} size={22} color={color.inkSoft} />
          {post.comment_count > 0 ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{post.comment_count}</Text> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: post.saved }}
          accessibilityLabel={post.saved ? s.unsave : s.save}
          onPress={() => void toggleSave()}
          style={[styles.reaction, { marginLeft: "auto" }]}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" fill={post.saved ? color.accentInk : "none"} stroke={post.saved ? color.accentInk : color.inkSoft} strokeWidth={1.8} strokeLinejoin="round">
            <Path d={BOOKMARK} />
          </Svg>
        </Pressable>
      </View>
      {error ? <Text style={{ paddingHorizontal: 16, paddingBottom: 10, fontFamily: font.regular, fontSize: 11.5, color: color.risk }}>{fill(error, {})}</Text> : null}
    </View>
  );
}

/** The post itself, by kind (social.tsx PostMedia): the workout tile, the gold tiles, a shared routine. */
function PostBody({ post, picture }: { post: FeedPostV1; picture: { url: string; ratio: number } | null }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const p = post.payload;
  if (!p || p.kind === "text" || p.kind === "progress" || p.kind === "shared_post") return null;

  const label = (icon: string, text: string, ink: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <NavIcon d={icon} size={14} color={ink} />
      <Text style={{ fontFamily: font.bold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: ink }}>{text}</Text>
    </View>
  );
  const gold = (children: React.ReactNode) => <View style={[styles.tile, { backgroundColor: color.accent }]}>{children}</View>;
  const goldInk = color.accentFg;
  const goldSoft = alpha(color.accentFg, 0.7);
  const hero = { marginTop: 8, fontFamily: font.displayExtrabold, fontSize: 44, lineHeight: 46, color: goldInk } as const;

  if (p.kind === "workout") {
    const stat = (value: string, unit: string | null, text: string) => (
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.displayExtrabold, fontSize: 20, color: color.ink }}>
          {value}
          {unit ? <Text style={{ fontFamily: font.medium, fontSize: 12, color: color.inkFaint }}>{` ${unit}`}</Text> : null}
        </Text>
        <Text style={{ fontFamily: font.regular, fontSize: 11, color: color.inkFaint }}>{text}</Text>
      </View>
    );
    return (
      <View style={[styles.tile, { backgroundColor: color.bg, padding: 0, overflow: "hidden" }]}>
        {picture ? <Image source={{ uri: picture.url }} style={{ width: "100%", aspectRatio: Math.max(0.6, Math.min(picture.ratio, 1.9)) }} resizeMode="cover" /> : null}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}>
          {label(DUMBBELL, s.workoutPost, color.accentInk)}
          <Text numberOfLines={1} style={{ marginTop: 4, marginBottom: 14, fontFamily: font.displayExtrabold, fontSize: 24, color: color.ink }}>{p.name}</Text>
          <View style={{ flexDirection: "row", gap: 12 }}>
            {p.duration_min ? stat(String(p.duration_min), "min", s.statDuration) : null}
            {stat(nf.format(p.volume_kg), "kg", s.statVolume)}
            {stat(nf.format(p.sets), null, s.statSets)}
            {stat(nf.format(p.exercises), null, s.statExercises)}
          </View>
          <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <NavIcon d={FLAME} size={16} color={color.accentInk} />
            <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{fill(s.trainingLoad, { load: p.load })}</Text>
            <View style={{ flex: 1, height: 5, borderRadius: 999, overflow: "hidden", backgroundColor: color.line }}>
              <View style={{ height: "100%", width: `${p.load}%`, borderRadius: 999, backgroundColor: color.accent }} />
            </View>
            {p.prs > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 10, height: 24, backgroundColor: color.accent }}>
                <NavIcon d={TROPHY} size={13} color={color.accentFg} strokeWidth={2.2} />
                <Text style={{ fontFamily: font.bold, fontSize: 11.5, color: color.accentFg }}>{p.prs === 1 ? s.prOne : fill(s.prMany, { count: p.prs })}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  }
  if (p.kind === "pr") {
    return gold(
      <>
        {label(TROPHY, s.newPr, goldSoft)}
        <Text style={hero}>
          {nf.format(p.weight_kg)}
          <Text style={{ fontFamily: font.semibold, fontSize: 17, color: goldSoft }}> kg</Text>
          <Text style={{ fontFamily: font.bold, fontSize: 21, color: goldSoft }}>{`  × ${p.reps}`}</Text>
        </Text>
        <Text style={{ marginTop: 10, fontFamily: font.semibold, fontSize: 15, color: goldInk }}>{p.exercise}</Text>
        <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: goldSoft }}>{s.personalBest}</Text>
      </>,
    );
  }
  if (p.kind === "challenge_completed") {
    return gold(
      <>
        {label(TROPHY, s.challengeCompleted, goldSoft)}
        <Text style={{ marginTop: 8, fontFamily: font.displayExtrabold, fontSize: 24, color: goldInk }}>{locale === "ro" ? p.title_ro : p.title_en}</Text>
        <Text style={{ marginTop: 6, fontFamily: font.semibold, fontSize: 15, color: goldSoft }}>
          {`${nf.format(p.value)} / ${nf.format(p.target)} ${t.common.challenges.unit[p.type as keyof typeof t.common.challenges.unit] ?? ""}`}
        </Text>
      </>,
    );
  }
  if (p.kind === "achievement") {
    return gold(
      <>
        {label(TROPHY, s.achievementPost, goldSoft)}
        <Text style={{ marginTop: 10, fontFamily: font.displayExtrabold, fontSize: 24, color: goldInk }}>{(locale === "ro" ? p.name_ro : p.name_en) ?? p.badge_slug}</Text>
        {isAchievementRarity(p.rarity) ? (
          <Text style={{ marginTop: 8, fontFamily: font.bold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: goldSoft }}>{t.common.achievements.rarities[p.rarity]}</Text>
        ) : null}
      </>,
    );
  }
  if (p.kind === "fitness_score") {
    return gold(
      <>
        {label(TREND, s.fitnessScorePost, goldSoft)}
        <Text style={hero}>
          {p.score}
          <Text style={{ fontFamily: font.semibold, fontSize: 17, color: goldSoft }}> / 100</Text>
        </Text>
        <Text style={{ marginTop: 10, fontFamily: font.semibold, fontSize: 15, color: goldInk }}>{fill(s.fitnessScoreReached, { milestone: p.milestone })}</Text>
      </>,
    );
  }
  if (p.kind === "program") {
    const r = t.clientApp.routines;
    const facts = [fill(r.daysCount, { count: p.days }), fill(r.exercisesCount, { count: p.exercises }), p.est_minutes > 0 ? fill(r.aboutMinutes, { count: p.est_minutes }) : null].filter(Boolean);
    return (
      <View style={[styles.tile, { backgroundColor: color.bg }]}>
        {label(DUMBBELL, r.sharedRoutine, color.inkFaint)}
        <Text style={{ marginTop: 8, fontFamily: font.displayExtrabold, fontSize: 22, color: color.ink }}>{p.name}</Text>
        {p.description ? <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{p.description}</Text> : null}
        <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{facts.join(" · ")}</Text>
      </View>
    );
  }
  if (p.kind !== "streak") return null;
  return gold(
    <>
      {label(FLAME, t.common.streaks.title, goldSoft)}
      <Text style={hero}>
        {p.milestone}
        <Text style={{ fontFamily: font.semibold, fontSize: 17, color: goldSoft }}>{` ${t.common.streaks.days}`}</Text>
      </Text>
      <Text style={{ marginTop: 10, fontFamily: font.semibold, fontSize: 15, color: goldInk }}>{fill(t.common.streaks.milestoneTitle, { count: p.milestone })}</Text>
      <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: goldSoft }}>{fill(t.common.streaks.postBody, { count: p.streak_days })}</Text>
    </>,
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  pill: { height: 36, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 18, paddingHorizontal: 14 },
  tabs: { flexDirection: "row", gap: 4, borderRadius: 999, borderWidth: 1, padding: 4 },
  tab: { flex: 1, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  empty: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 24, paddingVertical: 40 },
  more: { height: 44, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 24, overflow: "hidden" },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  tile: { marginHorizontal: 12, borderRadius: 16, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  reaction: { height: 40, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingHorizontal: 10 },
});
