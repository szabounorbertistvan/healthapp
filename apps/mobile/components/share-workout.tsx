import type { ShareCardV1 } from "@healthapp/api/v1";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Chip } from "@/components/coach-profile-bits";
import { ShareCardSheet } from "@/components/share-card";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// "Share Workout" (components/share-workout.tsx): the card for one finished
// session, as an image for Instagram Stories and the like. The server lays it
// out (and decides every number); the format, which stats show and the
// profile are the reader's to change when their plan allows it — otherwise the
// default Story card, with nothing about plans or upgrades on screen.

const STATS = ["duration", "exercises", "sets", "volume", "load", "prs"] as const;
type Stat = (typeof STATS)[number];

export function ShareWorkoutButton({ sessionId, label, style }: { sessionId: string; label?: string; style?: "primary" | "quiet" }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const [open, setOpen] = useState(false);
  const primary = style !== "quiet";
  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}
        style={[styles.button, primary ? { backgroundColor: color.accent } : { height: 36, borderRadius: 18, paddingHorizontal: 14, backgroundColor: color.bg }]}>
        <Text style={{ fontFamily: primary ? font.displayBold : font.semibold, fontSize: primary ? 14 : 12, color: primary ? color.accentFg : color.inkSoft }}>{label ?? t.common.shareCard.shareWorkout}</Text>
      </Pressable>
      {open ? <ShareWorkoutModal sessionId={sessionId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ShareWorkoutModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.common.shareCard;
  const [format, setFormat] = useState<"story" | "square">("story");
  const [stats, setStats] = useState<Record<Stat, boolean>>({ duration: true, exercises: true, sets: true, volume: true, load: true, prs: true });
  const [profile, setProfile] = useState(true);
  const [editing, setEditing] = useState(false);
  const query = new URLSearchParams({ session: sessionId, format, stats: STATS.filter((k) => stats[k]).join(","), profile: profile ? "1" : "0" }).toString();
  const card = useQuery({ queryKey: ["share-card", "workout", query], queryFn: () => api.workoutShareCard(query), placeholderData: (p) => p });
  const data: ShareCardV1 | null = card.data ?? null;

  const controls = data?.customize ? (
    <View style={{ marginTop: 14, gap: 10 }}>
      <View accessibilityRole="radiogroup" accessibilityLabel={s.format} style={{ flexDirection: "row", justifyContent: "center", gap: 8 }}>
        {(["story", "square"] as const).map((f) => <Chip key={f} on={format === f} label={f === "story" ? s.story : s.square} onPress={() => setFormat(f)} />)}
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: editing }} onPress={() => setEditing((v) => !v)} style={[styles.edit, { borderColor: color.line }]}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{s.editStats}</Text>
      </Pressable>
      {editing ? (
        <View style={{ borderRadius: 12, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg, padding: 12, gap: 10 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {STATS.map((k) => <Chip key={k} on={stats[k]} label={s[k === "load" ? "trainingLoad" : k]} onPress={() => setStats((o) => ({ ...o, [k]: !o[k] }))} />)}
          </View>
          {data.has_profile ? (
            <View accessibilityRole="radiogroup" accessibilityLabel={s.showProfile} style={{ flexDirection: "row", gap: 6 }}>
              <Chip on={profile} label={s.showProfile} onPress={() => setProfile(true)} />
              <Chip on={!profile} label={s.hideProfile} onPress={() => setProfile(false)} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: "rgba(0,0,0,0.6)" }]}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}>
          {card.isError ? (
            <View style={{ margin: 16, borderRadius: 20, padding: 20, backgroundColor: color.surface, gap: 12 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.risk }}>{s.notFound}</Text>
              <Pressable accessibilityRole="button" onPress={onClose}><Text style={{ fontFamily: font.semibold, color: color.inkSoft }}>{s.close}</Text></Pressable>
            </View>
          ) : (
            <View style={{ margin: 12 }}><ShareCardSheet key={data?.file_name ?? "loading"} card={data} controls={controls} onClose={onClose} /></View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: { height: 44, borderRadius: 16, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1 },
  edit: { minHeight: 40, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
