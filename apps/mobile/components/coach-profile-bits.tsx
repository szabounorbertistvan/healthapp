import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// Small pieces the coach-profile screens share (the web's Chip, SMALL_BUTTON,
// BUTTON, the status pills and useCoachError() from coach-profile/status.tsx).

export type Tone = "neutral" | "warn" | "accent" | "risk";

/** One line of copy for a failed coach-profile write (useCoachError). */
export function useCoachError() {
  const { t } = useI18n();
  const e = t.coachProfile.errors;
  return (result: { errorCode?: string } | unknown) => {
    if (result instanceof ApiFailure) return result.kind === "offline" ? t.mobile.errors.offline : e.generic;
    const code = (result as { errorCode?: string } | null)?.errorCode;
    return (code && code in e ? e[code as keyof typeof e] : null) ?? (code === "NO_ROWS" ? e.PROFILE_LOCKED : null) ?? e.generic;
  };
}

/** A toggle chip: gold when on (components/ui.tsx Chip). */
export function Chip({ on, onPress, label, disabled }: { on: boolean; onPress: () => void; label: string; disabled?: boolean }) {
  const { color } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: on ? color.accent : color.bg, borderColor: on ? color.accent : color.line, opacity: disabled ? 0.45 : 1 }]}
    >
      <Text style={{ fontFamily: font.semibold, fontSize: 13, color: on ? color.accentFg : color.inkSoft }}>{label}</Text>
    </Pressable>
  );
}

/** SMALL_BUTTON: a quiet pill; `tone="risk"` for a delete. */
export function Small({ label, onPress, disabled, tone, style }: { label: string; onPress: () => void; disabled?: boolean; tone?: "risk"; style?: ViewStyle }) {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.small, { backgroundColor: color.bg, opacity: disabled ? 0.5 : 1 }, style]}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: tone === "risk" ? color.risk : color.inkSoft }}>{label}</Text>
    </Pressable>
  );
}

/** BUTTON: the gold one. */
export function Primary({ label, onPress, disabled, busy }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  const { color } = useTheme();
  const off = Boolean(disabled || busy);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress} style={[styles.primary, { backgroundColor: color.accent, opacity: off ? 0.5 : 1 }]}>
      {busy ? <ActivityIndicator color={color.accentFg} /> : null}
      <Text style={{ fontFamily: font.bold, fontSize: 13.5, color: color.accentFg }}>{label}</Text>
    </Pressable>
  );
}

/** A status pill in one of the four tones. */
export function Pill({ label, tone }: { label: string; tone: Tone }) {
  const { color } = useTheme();
  const look = tone === "warn" ? { bg: color.warnSoft, ink: color.warn } : tone === "accent" ? { bg: color.accentSoft, ink: color.accentInk } : tone === "risk" ? { bg: color.riskSoft, ink: color.risk } : { bg: color.bg, ink: color.inkSoft };
  return (
    <View style={[styles.pill, { backgroundColor: look.bg }]}>
      <Text style={{ fontFamily: font.semibold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: look.ink }}>{label}</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const { color } = useTheme();
  return <Text accessibilityRole="alert" style={{ marginTop: 6, fontFamily: font.semibold, fontSize: 12.5, lineHeight: 18, color: color.risk }}>{children}</Text>;
}

/** The note on a coloured panel: a reviewer's note, a reason. */
export function Note({ children, tone }: { children: ReactNode; tone: "warn" | "risk" }) {
  const { color } = useTheme();
  return (
    <View style={{ marginTop: 10, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: tone === "warn" ? color.warnSoft : color.riskSoft }}>
      <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: tone === "warn" ? color.warn : color.risk }}>{children}</Text>
    </View>
  );
}

/** "12 / 160", red past the limit (wizard.tsx Counter). */
export function Counter({ n, max }: { n: number; max: number }) {
  const { fill, t } = useI18n();
  const { color } = useTheme();
  return <Text style={{ fontFamily: font.regular, fontSize: 12, color: n > max ? color.risk : color.inkFaint }}>{fill(t.coachProfile.wizard.counter, { n, max })}</Text>;
}

/** The uppercase section label. */
export function Section({ children }: { children: ReactNode }) {
  const { color } = useTheme();
  return <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{children}</Text>;
}

/** A ✓ ring: filled once done; dashed-looking (an outline) when optional. */
export function Tick({ done, optional }: { done: boolean; optional?: boolean }) {
  const { color } = useTheme();
  return (
    <View style={[styles.tick, { backgroundColor: done ? color.accent : optional ? "transparent" : color.surface, borderWidth: !done && optional ? 1 : 0, borderColor: color.line }]}>
      <Text style={{ fontFamily: font.bold, fontSize: 11, color: done ? color.accentFg : color.inkFaint }}>{done ? "✓" : ""}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, justifyContent: "center" },
  small: { height: 34, borderRadius: 17, paddingHorizontal: 13, justifyContent: "center" },
  primary: { height: 44, borderRadius: 14, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  pill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tick: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
