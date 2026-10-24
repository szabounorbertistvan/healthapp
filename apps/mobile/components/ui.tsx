import { LinearGradient } from "expo-linear-gradient";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { font, fontSize, minTouchTarget, radius, space, useTheme } from "@/lib/theme";

// The web's building blocks on the phone, each copied from its source:
//   Screen + Backdrop  → body + body::before (the ambient gold / cool fields)
//   Card               → components/ui.tsx Card (`glass`, rounded-3xl when plain)
//   Button "primary"   → `.glass--accent` (the gold pane), "quiet" → `.glass--subtle`
//   NavIcon            → client-nav.tsx NavIcon (24-box stroke paths, 1.8 wide)
//   Logo               → components/logo.tsx (the mark + the wordmark PNG)
//   T                  → the type scale: Inter for text, Exo 2 for display

/** The ambient light behind every screen (globals.css body::before), drawn once. */
export function Backdrop() {
  const { glass, color } = useTheme();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color.bg }]}>
      <Svg width="100%" height="100%">
        <Defs>
          {glass.glows.map((g, i) => (
            <RadialGradient key={i} id={`glow${i}`} cx={g.cx} cy={g.cy} rx={g.rx} ry={g.ry} fx={g.cx} fy={g.cy} gradientUnits="objectBoundingBox">
              <Stop offset="0" stopColor={g.color} stopOpacity={g.opacity} />
              <Stop offset="0.62" stopColor={g.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {glass.glows.map((_, i) => (
          <Rect key={i} x="0" y="0" width="100%" height="100%" fill={`url(#glow${i})`} />
        ))}
      </Svg>
    </View>
  );
}

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flex: 1 }, style]}>{children}</View>;
}

type Pane = "standard" | "strong" | "subtle";

/** A Liquid Glass pane: a few percent of white, a lit rim at the top-left, a soft shadow. */
export function Glass({
  children,
  style,
  pane = "standard",
  radius: r = 24,
}: {
  children?: ReactNode;
  style?: ViewStyle | ViewStyle[];
  pane?: Pane;
  radius?: number;
}) {
  const { glass, dark } = useTheme();
  const fill = pane === "strong" ? glass.fillStrong : pane === "subtle" ? glass.fillSubtle : glass.fill;
  return (
    <View
      style={[
        {
          borderRadius: r,
          backgroundColor: fill,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: glass.border,
          shadowColor: glass.shadow,
          shadowOpacity: dark ? 0.6 : 0.18,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 14 },
          elevation: 0,
          overflow: "hidden",
        },
        style as ViewStyle,
      ]}
    >
      {/* the 135° fall of light, strongest at the lit corner */}
      <LinearGradient
        pointerEvents="none"
        colors={[glass.corner, "rgba(255,255,255,0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.7, y: 0.7 }}
        style={StyleSheet.absoluteFill}
      />
      {/* the rim along the top edge: white where the light hits, then the gold catch */}
      <LinearGradient
        pointerEvents="none"
        colors={[glass.highlight, glass.highlightWarm, "rgba(255,255,255,0)"]}
        locations={[0, 0.25, 0.7]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: StyleSheet.hairlineWidth * 2 }}
      />
      {children}
    </View>
  );
}

/** components/ui.tsx Card: a glass pane; `flush` = the web's `p-0` (rows reach the edges). */
export function Card({ children, style, flush = false }: { children: ReactNode; style?: ViewStyle; flush?: boolean }) {
  // A flush card keeps the 16 too: on the web its p-0 loses to p-4, so every
  // card's rows sit 16 + their own 20 in from the edge, and that is the look.
  return <Glass style={[flush ? { padding: 16 } : { padding: 16, gap: space.sm }, style ?? {}]}>{children}</Glass>;
}

type TextKind = "title" | "heading" | "display" | "body" | "soft" | "faint" | "accent" | "label";

/**
 * Text in the web's scale. title = the page h1 (Exo 2 800, 24), display = a
 * card's big line (Exo 2 800, 19), heading = a row title (Inter 600, 14.5),
 * label = the uppercase card label (Inter 600, 11, tracking-wider).
 */
export function T({
  kind = "body",
  children,
  style,
  numberOfLines,
}: {
  kind?: TextKind;
  children: ReactNode;
  style?: TextStyle;
  numberOfLines?: number;
}) {
  const { color } = useTheme();
  const look: Record<TextKind, TextStyle> = {
    title: { fontFamily: font.displayExtrabold, fontSize: 24, letterSpacing: -0.4, color: color.ink },
    display: { fontFamily: font.displayExtrabold, fontSize: 19, letterSpacing: -0.3, color: color.ink },
    heading: { fontFamily: font.semibold, fontSize: 14.5, color: color.ink },
    body: { fontFamily: font.regular, fontSize: 14, color: color.ink },
    soft: { fontFamily: font.regular, fontSize: 13, color: color.inkSoft },
    faint: { fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint },
    accent: { fontFamily: font.semibold, fontSize: 13, color: color.accentInk },
    label: { fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint },
  };
  return (
    <Text numberOfLines={numberOfLines} style={[look[kind], style]}>
      {children}
    </Text>
  );
}

/** The 24-box stroke icon every web screen uses (client-nav.tsx NavIcon). */
export function NavIcon({ d, size = 20, color, strokeWidth = 1.8 }: { d: string; size?: number; color: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d={d} />
    </Svg>
  );
}

export const ICON = {
  check: "m5 12 5 5 9-10",
  chevron: "m9 6 6 6-6 6",
  back: "m15 6-6 6 6 6",
  plus: "M12 5v14M5 12h14",
  down: "m6 9 6 6 6-6",
  today: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  training: "M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8",
  programs: "M4 5h11a2 2 0 0 1 2 2v13H6a2 2 0 0 1-2-2zM17 20h3V6a2 2 0 0 0-2-2h-1M8 9h5M8 13h5",
  nutrition: "M3 12h18a9 9 0 0 1-18 0zM8 12c0-3 2-5 5-6 2 2 3 4 1 6",
  habits: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M8 12l3 3 5-6",
  progress: "M4 20h16M6 17v-4M11 17V9M16 17v-6M4 8l5-3 4 3 7-5M17 3h3v3",
  checkIn: "M9 4h6v3H9zM7 6H5v14h14V6h-2M9 13h6M9 17h4",
  challenges: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  gyms: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  achievements: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12M8.2 13.6 7 22l5-3 5 3-1.2-8.4",
  feed: "M4 5h16v11H9l-5 4z",
  saved: "M6 3h12v18l-6-4.5L6 21z",
  notifications: "M12 4a5 5 0 0 0-5 5v3l-1.5 3h13L17 12V9a5 5 0 0 0-5-5M10 18a2 2 0 0 0 4 0",
  coach: "M12 4a4 4 0 1 0 0 8 4 4 0 1 0 0-8M4 21a8 8 0 0 1 16 0",
  bookings: "M4 6h16v14H4zM4 10h16M8 4v4M16 4v4",
  account: "M12 4a4 4 0 1 0 0 8 4 4 0 1 0 0-8M4 21a8 8 0 0 1 16 0M19 3v4M17 5h4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  leaderboards: "M4 20V10M12 20V4M20 20v-7",
  dashboard: "M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z",
  clients: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20a7 7 0 0 1 14 0M17 11a3 3 0 0 0 0-6M18 20h4a6 6 0 0 0-3-5.2",
  library: "M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 0-2 2zM4 4v18M8 8h6",
  marketplace: "M3 9l2-5h14l2 5M3 9h18M3 9v11h18V9M9 20v-6h6v6",
  messages: "M4 5h16v11H9l-5 4z",
  myTraining: "M3 12h4l2-5 3 10 2-5h7",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01",
  signOut: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
} as const;

/** The mark and the wordmark, as on the web (logo.tsx); the light theme inks the white lettering. */
export function Logo({ height = 26 }: { height?: number }) {
  const { dark, color } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: height * 0.45 }}>
      <Image source={require("@/assets/brand/voinic-mark.png")} style={{ width: height * 1.6, height: height * 1.6 }} resizeMode="contain" />
      <Image
        source={require("@/assets/brand/voinic-wordmark.png")}
        style={{ width: height * (781 / 141), height, tintColor: dark ? undefined : color.ink }}
        resizeMode="contain"
      />
    </View>
  );
}

/**
 * The primary action — `.glass--accent`: gold in a 135° fall of light, a darker
 * rim, a hairline of light on top — and the quiet one, `.glass--subtle`.
 */
export function Button({
  label,
  onPress,
  busy,
  kind = "primary",
  icon,
  height = 44,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  kind?: "primary" | "quiet";
  /** A NavIcon path drawn after the label (the web's chevron on "Start workout"). */
  icon?: string;
  height?: number;
  disabled?: boolean;
}) {
  const { color, glass, accentStops } = useTheme();
  const primary = kind === "primary";
  const off = Boolean(busy || disabled);
  const ink = primary ? color.accentFg : color.inkSoft;
  const content = (
    <View style={[styles.buttonInner, { height }]}>
      {busy ? <ActivityIndicator color={ink} /> : null}
      <Text style={{ fontFamily: primary ? font.bold : font.semibold, fontSize: primary ? 14 : 13, color: ink }}>{label}</Text>
      {icon && !busy ? <NavIcon d={icon} size={14} color={ink} strokeWidth={2.6} /> : null}
    </View>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(busy), disabled: off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [{ opacity: off ? 0.5 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }]}
    >
      {primary ? (
        <LinearGradient
          colors={[...accentStops]}
          locations={[0, 0.48, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.button, { borderColor: accentStops[2], shadowColor: color.accent }]}
        >
          <View pointerEvents="none" style={styles.buttonSheen} />
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.button, { backgroundColor: glass.fillSubtle, borderColor: glass.border, shadowOpacity: 0 }]}>{content}</View>
      )}
    </Pressable>
  );
}

/** The uppercase card label with an optional note on the right (today-dashboard.tsx CardLabel). */
export function CardLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.cardLabel}>
      <T kind="label">{children}</T>
      {right ? (
        <T kind="faint" numberOfLines={1} style={{ flexShrink: 1, textAlign: "right" }}>
          {right}
        </T>
      ) : null}
    </View>
  );
}

/** A filled gold ✓ once done, an empty ring until then (today-dashboard.tsx Dot). */
export function Dot({ done }: { done: boolean }) {
  const { color } = useTheme();
  return (
    <View
      style={[
        styles.dot,
        done ? { borderColor: color.accent, backgroundColor: color.accent } : { borderColor: color.line, backgroundColor: "transparent" },
      ]}
    >
      {done ? <NavIcon d={ICON.check} size={13} color={color.accentFg} strokeWidth={2.6} /> : null}
    </View>
  );
}

export function Chevron() {
  const { color } = useTheme();
  return <NavIcon d={ICON.chevron} size={16} color={color.inkFaint} strokeWidth={2.2} />;
}

/** A thin hairline between rows (`divide-line/60`). */
export function Divider() {
  const { color } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: color.line, opacity: 0.6 }} />;
}

/** A progress bar: `h-1` track in the page colour, the fill in gold (or warn when over). */
export function Bar({ ratio, over = false, height = 4 }: { ratio: number; over?: boolean; height?: number }) {
  const { color } = useTheme();
  const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return (
    <View style={{ height, borderRadius: 999, backgroundColor: color.bg, overflow: "hidden" }}>
      <View style={{ width: `${r * 100}%`, height, borderRadius: 999, backgroundColor: over ? color.warn : color.accent }} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  buttonSheen: { position: "absolute", left: 0, right: 0, top: 0, height: 1, backgroundColor: "rgba(255,255,255,0.35)" },
  buttonInner: {
    minHeight: minTouchTarget,
    paddingHorizontal: space.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  cardLabel: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
});

export { fontSize, radius };

/**
 * 1..10 on a track, like the web's range input: tap or drag anywhere on it.
 * Plain responder events, so it needs no native slider module.
 */
export function Slider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const { color } = useTheme();
  const [width, setWidth] = useState(0);
  const pick = (x: number) => {
    if (width <= 0) return;
    const v = Math.round(1 + (Math.min(Math.max(x, 0), width) / width) * 9);
    if (v !== value) onChange(v);
  };
  const ratio = (value - 1) / 9;
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 1, max: 10, now: value }}
      onAccessibilityAction={(ev) => {
        if (ev.nativeEvent.actionName === "increment") onChange(Math.min(10, value + 1));
        if (ev.nativeEvent.actionName === "decrement") onChange(Math.max(1, value - 1));
      }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onLayout={(ev) => setWidth(ev.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(ev) => pick(ev.nativeEvent.locationX)}
      onResponderMove={(ev) => pick(ev.nativeEvent.locationX)}
      style={{ height: 28, justifyContent: "center", marginTop: 2 }}
    >
      <View pointerEvents="none" style={{ height: 8, borderRadius: 999, backgroundColor: color.bg, borderWidth: 1, borderColor: color.line, overflow: "hidden" }}>
        <View style={{ height: "100%", width: `${ratio * 100}%`, backgroundColor: color.accent }} />
      </View>
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: Math.max(0, ratio * width - 9), width: 18, height: 18, borderRadius: 9, backgroundColor: color.accent }}
      />
    </View>
  );
}
