import { formatRestClock, isRestActive } from "@healthapp/shared";
import { Pressable, StyleSheet, View } from "react-native";
import { T } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useRest } from "@/lib/rest";
import { minTouchTarget, radius, space, useTheme } from "@/lib/theme";

/** The rest countdown under the logger's header — the web's rest-timer bar. */
export function RestBar() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const rest = useRest();
  const timer = rest.timer;
  if (!timer || timer.status === "skipped") return null;
  const done = timer.status === "completed";
  const next = timer.context.next;

  const button = (label: string, onPress: () => void, a11y?: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      onPress={onPress}
      style={[styles.button, { borderColor: color.line }]}
    >
      <T style={{ fontWeight: "700", color: color.ink }}>{label}</T>
    </Pressable>
  );

  return (
    <View style={[styles.bar, { backgroundColor: done ? color.accent : color.surface, borderColor: color.line }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontWeight: "800", fontSize: 22, color: done ? color.accentFg : color.ink }}>
          {done ? t.mobile.workout.restOver : formatRestClock(rest.remaining)}
        </T>
        {next ? (
          <T kind="faint" style={done ? { color: color.accentFg } : undefined}>
            {`${t.clientWidgets.restTimer.next}: ${next.exerciseName} · ${fill(t.clientWidgets.restTimer.setN, { n: next.setIndex })}`}
          </T>
        ) : null}
      </View>
      {isRestActive(timer) ? (
        <View style={styles.actions}>
          {timer.status === "paused"
            ? button(t.clientWidgets.restTimer.resume, rest.resume)
            : button(t.clientWidgets.restTimer.pause, rest.pause)}
          {button(t.clientWidgets.restTimer.add15, rest.extend, t.clientWidgets.restTimer.add15Label)}
          {button(t.clientWidgets.restTimer.skip, rest.skip)}
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={rest.clear} style={[styles.button, { borderColor: color.accentFg }]}>
          <T style={{ fontWeight: "700", color: color.accentFg }}>{t.clientWidgets.restTimer.dismiss}</T>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  actions: { flexDirection: "row", gap: space.xs },
  button: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
});
