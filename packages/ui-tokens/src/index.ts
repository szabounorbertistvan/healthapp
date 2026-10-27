// Design tokens, light + dark (plan §8 Phase 0).
//
// React Native has no CSS variables, so the values live in TypeScript and each
// surface maps them: the web declares them as --color-* in apps/web/app/globals.css,
// the Expo app (apps/mobile) feeds them to its theme. One palette, two consumers —
// index.test.ts fails the moment the two disagree.
//
// Voinic: near-black + gold. Dark is the brand look; light sits on a cool
// graphite grey so the gold stays the only warm thing on screen. Text on gold is
// always `accentFg`, never white; small accent text uses `accentInk`.

export type ColorTokens = {
  bg: string;
  surface: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  line: string;
  accent: string;
  accentFg: string;
  accentInk: string;
  accentSoft: string;
  warn: string;
  warnSoft: string;
  risk: string;
  riskSoft: string;
  /** The inverse tile (a feed post's media): cream on dark, near-black on light. */
  tile: string;
  tileInk: string;
  tileSoft: string;
  tileAccent: string;
  tileLine: string;
};

export const dark: ColorTokens = {
  bg: "#0b0b0d",
  surface: "#16171a",
  ink: "#f2efe8",
  inkSoft: "#b9b5ab",
  inkFaint: "#807c73",
  line: "#2a2b30",
  accent: "#d4a938",
  accentFg: "#0b0b0d",
  accentInk: "#e6c25a",
  accentSoft: "#2a2312",
  warn: "#e08a3c",
  warnSoft: "#33200f",
  risk: "#e06666",
  riskSoft: "#3a1c1c",
  tile: "#f2efe8",
  tileInk: "#0b0b0d",
  tileSoft: "#5b574f",
  tileAccent: "#8a6510",
  tileLine: "#dcd8cf",
};

export const light: ColorTokens = {
  bg: "#e6e9ef",
  surface: "#ffffff",
  ink: "#121519",
  inkSoft: "#464d56",
  inkFaint: "#737b85",
  line: "#dee3ea",
  accent: "#c9a227",
  accentFg: "#16161a",
  accentInk: "#7f5c0b",
  accentSoft: "#f4ebd6",
  warn: "#b5601c",
  warnSoft: "#fae7d8",
  risk: "#bc4242",
  riskSoft: "#f8e1e1",
  tile: "#121519",
  tileInk: "#f2efe8",
  tileSoft: "#b9b5ab",
  tileAccent: "#e6c25a",
  tileLine: "#2f3339",
};

/** Adherence signals are the app's core vocabulary — one colour each, both themes. */
export const signalColor = {
  on_track: { light: light.accent, dark: dark.accent },
  needs_attention: { light: light.warn, dark: dark.warn },
  at_risk: { light: light.risk, dark: dark.risk },
} as const;

/** Story backgrounds (globals.css --color-story-*): a story is a picture someone made, the same on every screen. */
export const storyColor = {
  storyNight: "#0b0b0d",
  storyNightInk: "#f2efe8",
  storyPaper: "#f2efe8",
  storyPaperInk: "#0b0b0d",
} as const;

export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 } as const;

/** 4pt base. Touch targets never go below 44 (PRODUCT_SPEC §9 accessibility). */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const minTouchTarget = 44;

export const fontSize = { xs: 11, sm: 13, base: 15, lg: 18, xl: 22, display: 28 } as const;
