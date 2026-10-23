import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { fontSize, minTouchTarget, radius, space, useTheme } from "@/lib/theme";

// The few building blocks every screen uses, themed from packages/ui-tokens —
// the phone's counterpart of the web's `.glass` card, FIELD and BUTTON.

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { color } = useTheme();
  return <View style={[{ flex: 1, backgroundColor: color.bg }, style]}>{children}</View>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { color } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: color.surface, borderColor: color.line }, style]}>{children}</View>
  );
}

type TextKind = "title" | "heading" | "body" | "soft" | "faint" | "accent";

export function T({ kind = "body", children, style }: { kind?: TextKind; children: ReactNode; style?: TextStyle }) {
  const { color } = useTheme();
  const look: Record<TextKind, TextStyle> = {
    title: { fontSize: fontSize.display, fontWeight: "800", color: color.ink },
    heading: { fontSize: fontSize.lg, fontWeight: "700", color: color.ink },
    body: { fontSize: fontSize.base, color: color.ink },
    soft: { fontSize: fontSize.base, color: color.inkSoft },
    faint: { fontSize: fontSize.sm, color: color.inkFaint },
    accent: { fontSize: fontSize.base, fontWeight: "600", color: color.accentInk },
  };
  return <Text style={[look[kind], style]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  busy,
  kind = "primary",
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  kind?: "primary" | "quiet";
}) {
  const { color } = useTheme();
  const primary = kind === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(busy), disabled: Boolean(busy) }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: color.accent }
          : { backgroundColor: "transparent", borderColor: color.line, borderWidth: 1 },
        { opacity: pressed || busy ? 0.7 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? color.accentFg : color.ink} /> : null}
      <Text style={{ fontSize: fontSize.base, fontWeight: "700", color: primary ? color.accentFg : color.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, borderWidth: 1, padding: space.lg, gap: space.sm },
  button: {
    minHeight: minTouchTarget + 4,
    borderRadius: radius.lg,
    paddingHorizontal: space.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
});
