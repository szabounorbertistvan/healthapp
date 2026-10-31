import type { PreviousSetV1, WorkoutDayV1, WorkoutExerciseV1 } from "@healthapp/api/v1";
import { kgToDisplay, type WeightUnit } from "@healthapp/shared";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { NavIcon, T } from "@/components/ui";
import type { Dictionary } from "@/lib/i18n";
import { formatDecimal, type Locale } from "@healthapp/i18n";
import { font, minTouchTarget, useTheme } from "@/lib/theme";

// Small pieces the day overview and the logger share.

/** "3×8-10 · RIR 2 · rest 90s" — the prescription line, as the web's logger writes it. */
export function prescription(e: WorkoutExerciseV1, mode: WorkoutDayV1["intensity_mode"], t: Dictionary): string {
  const reps = e.measure === "time" ? `${e.reps} ${t.clientWidgets.setLogger.seconds}` : e.reps;
  const parts = [`${e.sets}×${reps}`];
  if (e.target_rpe != null && mode !== "simple") {
    parts.push(`${mode === "rir" ? t.clientWidgets.setLogger.rir : t.clientWidgets.setLogger.rpe} ${e.target_rpe}`);
  }
  if (e.rest_seconds) parts.push(`${t.clientWidgets.setLogger.rest} ${e.rest_seconds}s`);
  return parts.join(" · ");
}

/** One set as "60 kg × 8" or "45 sec", in the person's unit. */
export function setText(
  s: Pick<PreviousSetV1, "weight_kg" | "reps" | "duration_seconds">,
  unit: WeightUnit,
  t: Dictionary,
  locale: Locale = "en",
): string {
  const kg = formatDecimal(kgToDisplay(s.weight_kg, unit), locale);
  if (s.duration_seconds) {
    return s.weight_kg > 0
      ? `${kg} ${unit} · ${s.duration_seconds} ${t.clientWidgets.setLogger.seconds}`
      : `${s.duration_seconds} ${t.clientWidgets.setLogger.seconds}`;
  }
  return `${kg} ${unit} × ${s.reps}`;
}

/** The web's back link (a chevron and the place it goes back to, 12 px, faint) — every pushed screen's first line. */
export function BackHeader({ label }: { label: string }) {
  const { color } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      style={styles.back}
    >
      <NavIcon d="m15 6-6 6 6 6" size={14} color={color.inkFaint} />
      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{label}</Text>
    </Pressable>
  );
}

export function Previous({ e, day, t }: { e: WorkoutExerciseV1; day: WorkoutDayV1; t: Dictionary }) {
  const last = e.exercise_id ? day.previous[e.exercise_id] : undefined;
  return (
    <View style={{ gap: 2 }}>
      <T kind="faint">{last ? t.mobile.workout.last : t.mobile.workout.lastNone}</T>
      {last ? <T kind="soft">{last.sets.map((s) => setText(s, day.weight_unit, t)).join("  ·  ")}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  back: { minHeight: minTouchTarget, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
});
