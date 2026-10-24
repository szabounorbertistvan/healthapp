import { dark, fontSize, light, minTouchTarget, radius, space, type ColorTokens } from "@healthapp/ui-tokens";
import { useColorScheme } from "react-native";

// The web's look on the phone. Colours are packages/ui-tokens (a test keeps
// them equal to apps/web/app/globals.css); the glass numbers below are copied
// from the `.glass` family in globals.css ("Liquid Glass"), per theme, so a
// card here is the same pane as a card there. Like the web, the app follows
// the device; dark is the brand look and the fallback.

export type Glass = {
  /** The pane's body: white at a few percent (dark) / mostly white (light). */
  fill: string;
  fillStrong: string;
  fillSubtle: string;
  /** The extra light at the lit (top-left) corner. */
  corner: string;
  border: string;
  /** The rim where the light hits, and its gold catch. */
  highlight: string;
  highlightWarm: string;
  shadow: string;
  /** globals.css --glass-alpha*, as numbers: the pane is tint at this alpha (+ the corner at the lit side). */
  alpha: { standard: number; strong: number; subtle: number; corner: number };
  /** The rim on the shadow side, and the pool of light inside the lit corner. */
  highlightLow: string;
  specular: string;
  /** --glass-shadow, as a CSS box-shadow list (outset layers only; the ring is added per pane). */
  dropShadow: string;
  /** The ambient fields behind everything (globals.css body::before). */
  glows: { cx: string; cy: string; rx: string; ry: string; color: string; opacity: number }[];
};

const glassDark: Glass = {
  fill: "rgba(255,255,255,0.058)",
  fillStrong: "rgba(255,255,255,0.11)",
  fillSubtle: "rgba(255,255,255,0.036)",
  corner: "rgba(255,255,255,0.05)",
  border: "rgba(255,255,255,0.17)",
  highlight: "rgba(255,255,255,0.42)",
  highlightWarm: "rgba(230,194,90,0.26)",
  shadow: "#000000",
  alpha: { standard: 0.058, strong: 0.11, subtle: 0.036, corner: 0.05 },
  highlightLow: "rgba(255,255,255,0.08)",
  specular: "rgba(255,255,255,0.055)",
  dropShadow: "0px 1px 1px rgba(0,0,0,0.3), 0px 18px 44px -14px rgba(0,0,0,0.75)",
  glows: [
    { cx: "10%", cy: "-8%", rx: "70%", ry: "55%", color: "#d4a938", opacity: 0.26 },
    { cx: "100%", cy: "22%", rx: "55%", ry: "48%", color: "#7a92be", opacity: 0.2 },
    { cx: "24%", cy: "78%", rx: "45%", ry: "38%", color: "#d4a938", opacity: 0.12 },
    { cx: "62%", cy: "108%", rx: "60%", ry: "45%", color: "#96aad2", opacity: 0.13 },
  ],
};

const glassLight: Glass = {
  fill: "rgba(255,255,255,0.195)",
  fillStrong: "rgba(255,255,255,0.33)",
  fillSubtle: "rgba(255,255,255,0.12)",
  corner: "rgba(255,255,255,0.055)",
  border: "rgba(18,21,25,0.12)",
  highlight: "rgba(255,255,255,1)",
  highlightWarm: "rgba(201,162,39,0.65)",
  shadow: "#121519",
  alpha: { standard: 0.195, strong: 0.33, subtle: 0.12, corner: 0.055 },
  highlightLow: "rgba(18,21,25,0.16)",
  specular: "rgba(255,255,255,0.9)",
  dropShadow: "0px 1px 1px rgba(18,21,25,0.06), 0px 2px 6px rgba(18,21,25,0.05), 0px 20px 48px -16px rgba(18,21,25,0.3)",
  glows: [
    { cx: "8%", cy: "-6%", rx: "70%", ry: "50%", color: "#c9a227", opacity: 0.42 },
    { cx: "102%", cy: "26%", rx: "55%", ry: "45%", color: "#6e8abe", opacity: 0.38 },
    { cx: "22%", cy: "72%", rx: "45%", ry: "35%", color: "#c9a227", opacity: 0.2 },
    { cx: "60%", cy: "110%", rx: "60%", ry: "45%", color: "#ffffff", opacity: 0.95 },
  ],
};

/** The gold button's three stops (globals.css .glass--accent): lighter, the accent, a touch darker. */
const accentStops = {
  dark: ["#dbb75b", "#d4a938", "#c59d34"] as const,
  light: ["#d1b04b", "#c9a227", "#bb9725"] as const,
};

export type Theme = { dark: boolean; color: ColorTokens; glass: Glass; accentStops: readonly [string, string, string] };

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === "light"
    ? { dark: false, color: light, glass: glassLight, accentStops: accentStops.light }
    : { dark: true, color: dark, glass: glassDark, accentStops: accentStops.dark };
}

/**
 * The web's type: Inter for text, Exo 2 for display (titles, numbers). A
 * custom font needs one family per weight on React Native — `fontWeight` would
 * be ignored — so a weight is a family here.
 */
export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  displaySemibold: "Exo2_600SemiBold",
  displayBold: "Exo2_700Bold",
  displayExtrabold: "Exo2_800ExtraBold",
} as const;

export { fontSize, minTouchTarget, radius, space };

/** A colour token at an opacity — the web's `bg-accent-soft/55`. Takes #rgb / #rrggbb; anything else is returned as is. */
export function alpha(hex: string, opacity: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}
