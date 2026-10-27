import type { PersonV1 } from "@healthapp/api/v1";
import { followButtonState } from "@healthapp/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { alpha, font, useTheme } from "@/lib/theme";

// People on a phone (components/people-list.tsx, social.tsx FollowButton): a
// row opens the person's profile and the follow button sits beside it, not in
// it. Following is optimistic; unfollowing asks once (the label turns into
// "Unfollow" for three seconds).

export function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  const { color } = useTheme();
  return url ? <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} /> : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: size * 0.38, color: color.accentInk }}>{[...name.trim()][0]?.toUpperCase() ?? "?"}</Text>
    </View>
  );
}

export function FollowButton({ userId, following, followsMe = false, compact = false }: { userId: string; following: boolean; followsMe?: boolean; compact?: boolean }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const s = t.common.social;
  const [state, setState] = useState(following);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => setState(following), [following]);
  // the unfollow prompt lapses on its own
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(id);
  }, [confirming]);

  const look = followButtonState({ is_following: state, follows_me: followsMe });
  const label = confirming ? s.unfollow : look === "following" ? s.following : look === "follow_back" ? s.followBack : s.follow;

  async function send(next: boolean) {
    setConfirming(false);
    setError(false);
    setPending(true);
    const before = state;
    setState(next);
    try {
      const r = await api.follow(userId, next);
      if (!r.ok) throw new Error();
      void queryClient.invalidateQueries({ queryKey: ["person"] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    } catch {
      setState(before);
      setError(true);
    } finally {
      setPending(false);
    }
  }

  const look2 = confirming ? { bg: color.riskSoft, ink: color.risk, border: "transparent" } : state ? { bg: color.surface, ink: color.ink, border: color.line } : { bg: color.accent, ink: color.accentFg, border: color.accent };
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: state, busy: pending }} accessibilityHint={error ? s.followError : undefined} disabled={pending}
      onPress={() => { if (!state) void send(true); else if (confirming) void send(false); else setConfirming(true); }}
      style={[compact ? styles.compact : styles.full, { backgroundColor: look2.bg, borderColor: error ? color.risk : look2.border, opacity: pending ? 0.6 : 1 }]}>
      <Text style={{ fontFamily: font.semibold, fontSize: compact ? 12.5 : 13.5, color: look2.ink }}>{label}</Text>
    </Pressable>
  );
}

export function PeopleList({ people, detail }: { people: PersonV1[]; detail: (p: PersonV1) => string }) {
  const { color } = useTheme();
  const { session } = useAuth();
  const viewer = session?.user.id ?? null;
  return (
    <View style={[styles.list, { backgroundColor: color.surface, borderColor: color.line }]}>
      {people.map((p, i) => {
        const second = detail(p);
        return (
          <View key={p.id} style={[styles.row, i ? { borderTopWidth: 1, borderTopColor: alpha(color.line, 0.6) } : null]}>
            <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/people/[id]", params: { id: p.id } })} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Avatar name={p.name} url={p.avatar_url} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14.5, color: color.ink }}>{p.name}</Text>
                {second ? <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{second}</Text> : null}
              </View>
            </Pressable>
            {p.id !== viewer ? <FollowButton userId={p.id} following={p.is_following} followsMe={p.follows_me ?? false} compact /> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  full: { height: 40, minWidth: 136, borderRadius: 20, borderWidth: 1, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  compact: { height: 36, minWidth: 104, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  list: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 12 },
});
