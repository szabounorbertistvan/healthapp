import { useQueryClient } from "@tanstack/react-query";
import type { RoutineCard } from "@healthapp/shared";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { NavIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// A routine on the shelf — the web's components/routine-card.tsx on a phone:
// name, author, the facts (days a week, exercises, one session's minutes), the
// tags, the bookmark and Open.

const BOOKMARK = "M6 3h12v18l-6-4.5L6 21z";

export function routineFacts(card: RoutineCard, r: ReturnType<typeof useI18n>["t"]["clientApp"]["routines"], fill: ReturnType<typeof useI18n>["fill"]) {
  return [
    card.days_per_week === 1 ? r.perWeekOne : card.days_per_week > 0 ? fill(r.perWeek, { count: card.days_per_week }) : fill(r.daysCount, { count: card.days }),
    fill(r.exercisesCount, { count: card.exercises }),
    card.session_minutes > 0 ? fill(r.aboutMinutes, { count: card.session_minutes }) : null,
  ].filter((x): x is string => Boolean(x));
}

export function routineTags(card: RoutineCard, r: ReturnType<typeof useI18n>["t"]["clientApp"]["routines"]) {
  return [
    card.featured ? r.featured : null,
    card.source === "voinic" ? r.source.voinic : null,
    card.level ? r.level[card.level] : null,
    card.goal ? r.goal[card.goal] : null,
    card.training_style ? r.style[card.training_style] : null,
  ].filter((x): x is string => Boolean(x));
}

export function RoutineCardView({ card }: { card: RoutineCard }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const r = t.clientApp.routines;
  const open = () => router.push({ pathname: "/routine/[id]", params: { id: card.id } });
  const tags = routineTags(card, r);
  return (
    <View style={[styles.card, { backgroundColor: color.surface }]}>
      <Pressable accessibilityRole="link" onPress={open}>
        <Text numberOfLines={1} style={{ fontFamily: font.displayBold, fontSize: 18, letterSpacing: -0.2, color: color.ink }}>{card.name}</Text>
        <Text numberOfLines={1} style={{ marginTop: 3, fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{fill(r.by, { author: card.author_name })}</Text>
      </Pressable>
      <Text style={{ marginTop: 10, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{routineFacts(card, r, fill).join(" · ")}</Text>
      {card.muscle_groups.length > 0 ? (
        <Text numberOfLines={1} style={{ marginTop: 3, fontFamily: font.regular, fontSize: 12, color: color.inkFaint, textTransform: "capitalize" }}>{card.muscle_groups.join(" · ")}</Text>
      ) : null}
      {tags.length > 0 ? (
        <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {tags.map((tag) => (
            <View key={tag} style={[styles.tag, { backgroundColor: color.bg }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.inkSoft }}>{tag}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <SaveButton card={card} />
        {card.copy_count > 0 ? <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{fill(r.copiesCount, { count: card.copy_count })}</Text> : null}
        <Pressable accessibilityRole="link" onPress={open} style={[styles.open, { backgroundColor: color.accentSoft }]}>
          <Text style={{ fontFamily: font.bold, fontSize: 12, color: color.accentInk }}>{r.open}</Text>
          <NavIcon d="m9 6 6 6-6 6" size={15} color={color.accentInk} />
        </Pressable>
      </View>
    </View>
  );
}

/** The bookmark (toggleRoutineSave): moves at once, settles on the answer. */
export function SaveButton({ card, withLabel = false }: { card: RoutineCard; withLabel?: boolean }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const r = t.clientApp.routines;
  const [saved, setSaved] = useState(card.saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSaved(card.saved), [card.saved]);

  async function toggle() {
    setBusy(true);
    const before = saved;
    setSaved(!before);
    try {
      const res = await api.saveRoutine(card.id, before);
      if (!res.ok) setSaved(before);
      else void queryClient.invalidateQueries({ queryKey: ["routines"] });
    } catch {
      setSaved(before);
    } finally {
      setBusy(false);
    }
  }

  const ink = saved ? color.accentInk : color.inkSoft;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: saved }}
      accessibilityLabel={saved ? r.unsave : r.save}
      disabled={busy}
      onPress={() => void toggle()}
      style={[styles.save, { backgroundColor: saved ? color.accentSoft : color.bg, paddingHorizontal: withLabel ? 14 : 0, width: withLabel ? undefined : 36 }]}
    >
      <Svg width={17} height={17} viewBox="0 0 24 24" fill={saved ? ink : "none"} stroke={ink} strokeWidth={1.8} strokeLinejoin="round">
        <Path d={BOOKMARK} />
      </Svg>
      {withLabel ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: ink }}>{saved ? r.unsave : r.save}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, padding: 18 },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  open: { marginLeft: "auto", height: 36, borderRadius: 18, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 4 },
  save: { height: 36, borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
});
