import { Pressable, StyleSheet, View } from "react-native";
import { T } from "@/components/ui";
import { fontSize, minTouchTarget, radius, space, useTheme } from "@/lib/theme";

/** A 1–10 value with − / + buttons — the app's stand-in for the web's range slider. */
export function Stepper({
  value,
  onChange,
  label,
  format = String,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => string;
}) {
  const { color } = useTheme();
  const step = (d: number) => onChange(Math.max(1, Math.min(10, value + d)));
  const button = (text: string, d: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${text}`}
      onPress={() => step(d)}
      style={[styles.button, { borderColor: color.line }]}
    >
      <T style={{ fontWeight: "800", fontSize: fontSize.lg }}>{text}</T>
    </Pressable>
  );
  return (
    <View style={styles.row} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 1, max: 10, now: value }}>
      {button("−", -1)}
      <T kind="heading" style={{ minWidth: 48, textAlign: "center" }}>{format(value)}</T>
      {button("+", 1)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  button: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
});
