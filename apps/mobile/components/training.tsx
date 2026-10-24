import type { SessionCardV1, WorkoutDaySummaryV1 } from "@healthapp/api/v1";
import { router } from "expo-router";
import type { ColorTokens } from "@healthapp/ui-tokens";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Card, NavIcon } from "@/components/ui";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The web's training pieces (components/athlete.tsx, workout-day-list.tsx
// DayCard, training-load.tsx TrainingLoadBadge), one for one.

type Sex = "male" | "female" | "other" | null | undefined;

/** Intrinsic sizes of the brand athletes (athlete.tsx ATHLETES): the figure stands on the tile's bottom edge. */
const ATHLETES: Record<string, readonly [number, number]> = {
  "chest-m": [1021, 785], "chest-f": [1200, 698],
  "back-m": [745, 1200], "back-f": [718, 1200],
  "shoulders-m": [585, 1200], "shoulders-f": [548, 1200],
  "arms-m": [477, 1200], "arms-f": [449, 1200],
  "legs-m": [621, 1200], "legs-f": [636, 1200],
  "glutes-m": [582, 1200], "glutes-f": [489, 1200],
  "core-m": [1122, 765], "core-f": [1200, 826],
  "cardio-m": [668, 1200], "cardio-f": [649, 1200],
};

/** athlete.tsx athleteSex: the person's own sex, else a stable pick from the day id. */
function athleteSex(sex: Sex, seed: string): "m" | "f" {
  if (sex === "male") return "m";
  if (sex === "female") return "f";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 2 === 0 ? "m" : "f";
}

const athleteUri = (name: string) => `${config.webUrl}/brand/athletes/by-sex/${name}.webp`;

/**
 * The day page's athlete: fills its parent, the whole figure kept, standing on
 * the bottom edge 12 in from the right, 14 short of the top (the web's
 * "absolute bottom-0 right-3 h-[calc(100%-14px)] object-contain object-right-bottom").
 */
export function AthleteFigure({ type, sex, seed }: { type: string; sex: Sex; seed: string }) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const name = `${type}-${athleteSex(sex, seed)}`;
  const dims = ATHLETES[name];
  if (!dims) return null;
  const scale = box ? Math.min((box.w - 12) / dims[0], (box.h - 14) / dims[1]) : 0;
  return (
    <View style={StyleSheet.absoluteFill} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {box && scale > 0 ? (
        <Image
          source={{ uri: athleteUri(name) }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: "absolute", bottom: 0, right: 12, width: dims[0] * scale, height: dims[1] * scale }}
        />
      ) : null}
    </View>
  );
}

/** The day's athlete in an 84 px tile on the page background (the images are the web's public ones). */
function AthleteTile({ type, sex, seed }: { type: string; sex: Sex; seed: string }) {
  const { color } = useTheme();
  const name = `${type}-${athleteSex(sex, seed)}`;
  const dims = ATHLETES[name];
  if (!dims) return null;
  // inset-x-1.5, h-[calc(100%-6px)], object-contain object-bottom
  const boxW = 84 - 12;
  const boxH = 84 - 6;
  const scale = Math.min(boxW / dims[0], boxH / dims[1]);
  return (
    <View style={[styles.tile, { backgroundColor: color.bg }]}>
      <Image
        source={{ uri: athleteUri(name) }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: "absolute", bottom: 0, alignSelf: "center", width: dims[0] * scale, height: dims[1] * scale }}
      />
    </View>
  );
}

/** One day: the athlete, the name and count, the chevron, then every exercise with its sets × reps. */
export function DayCard({ day, sex, next }: { day: WorkoutDaySummaryV1; sex: Sex; next: boolean }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const w = t.clientApp.workout;
  const exercises = day.exercises ?? [];
  const inProgress = (day.logged ?? 0) > 0;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/workout/[dayId]", params: { dayId: day.day_id } })}>
      {({ pressed }) => (
        <Card style={{ padding: 14, gap: 0, ...(pressed ? { backgroundColor: color.accentSoft } : null) }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            {day.type ? <AthleteTile type={day.type} sex={sex} seed={day.day_id} /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              {inProgress ? (
                <Badge text={w.inProgress} bg={color.warnSoft} ink={color.warn} />
              ) : next ? (
                <Badge text={w.nextUp} bg={color.accentSoft} ink={color.accentInk} />
              ) : null}
              <Text numberOfLines={1} style={{ fontFamily: font.displayBold, fontSize: 20, lineHeight: 25, color: color.ink }}>{day.day_name}</Text>
              <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                {fill(w.exercisesCount, { count: day.exercise_count })}
              </Text>
            </View>
            <View style={[styles.chevron, { backgroundColor: color.accentSoft }]}>
              <NavIcon d="m9 6 6 6-6 6" size={14} color={color.accentInk} strokeWidth={2.2} />
            </View>
          </View>
          {exercises.length > 0 ? (
            <View style={{ marginTop: 12, paddingHorizontal: 6, gap: 2 }}>
              {exercises.map((e) => (
                <View key={e.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{e.name}</Text>
                  <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkFaint }}>
                    {`${e.sets}×${e.reps}${e.measure === "time" ? " s" : ""}`}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      )}
    </Pressable>
  );
}

function Badge({ text, bg, ink }: { text: string; bg: string; ink: string }) {
  return (
    <View style={{ alignSelf: "flex-start", marginBottom: 6, borderRadius: 999, backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 2 }}>
      <Text style={{ fontFamily: font.bold, fontSize: 11, color: ink }}>{text}</Text>
    </View>
  );
}

type LoadCategory = SessionCardV1["load"]["category"];

/** Category → tone (training-load.tsx TONE): light work is quiet, moderate gold, hard amber, very hard a warning. */
export function loadTone(category: LoadCategory, color: ColorTokens): { ink: string; bar: string; bg: string } {
  return {
    very_light: { ink: color.inkFaint, bar: color.inkFaint, bg: color.bg },
    light: { ink: color.inkSoft, bar: color.inkSoft, bg: color.bg },
    moderate: { ink: color.accentInk, bar: color.accent, bg: color.accentSoft },
    hard: { ink: color.warn, bar: color.warn, bg: color.warnSoft },
    very_hard: { ink: color.risk, bar: color.risk, bg: color.riskSoft },
  }[category];
}

/** "Load 82 · Hard" — the history rows' chip (TrainingLoadBadge); `showLabel` false drops "Load". */
export function LoadBadge({ load, showLabel = true }: { load: { score: number; category: LoadCategory }; showLabel?: boolean }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const l = t.common.trainingLoad;
  const tone = loadTone(load.category, color);
  return (
    <View style={{ borderRadius: 6, backgroundColor: tone.bg, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: tone.ink }}>
        {showLabel ? <Text style={{ fontFamily: font.medium, opacity: 0.8 }}>{`${l.short} `}</Text> : null}
        {load.score}
        <Text style={{ fontFamily: font.medium, opacity: 0.8 }}>{` · ${l.category[load.category]}`}</Text>
      </Text>
    </View>
  );
}

/** A secondary page action: a pill on the surface colour, icon + label (the web's PillLink). */
export function Pill({ icon, label, onPress }: { icon?: string; label: string; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.pill, { backgroundColor: color.surface, opacity: pressed ? 0.8 : 1 }]}
    >
      {icon ? <NavIcon d={icon} size={17} color={color.inkSoft} /> : null}
      <Text style={{ fontFamily: font.semibold, fontSize: icon ? 12 : 12.5, color: color.inkSoft }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { width: 84, height: 84, borderRadius: 16, overflow: "hidden" },
  chevron: { width: 32, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pill: { height: 36, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, paddingHorizontal: 14 },
});
