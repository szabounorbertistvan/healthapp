// Design tokens, light + dark (plan §8 Phase 0).
//
// React Native has no CSS variables, so the values live in TypeScript and each
// surface maps them: the web mirrors them into @theme in apps/web/app/globals.css,
// the Expo app will feed them to its theme provider. One palette, two consumers.

export type ColorTokens = {
  bg: string;
  surface: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  line: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  warn: string;
  warnSoft: string;
  risk: string;
  riskSoft: string;
};

export const light: ColorTokens = {
  bg: "#f4f6f5",
  surface: "#ffffff",
  ink: "#1d2422",
  inkSoft: "#4c5652",
  inkFaint: "#7a847f",
  line: "#dde3df",
  accent: "#0f9d6e",
  accentInk: "#0b7a56",
  accentSoft: "#e2f3ec",
  warn: "#b97f10",
  warnSoft: "#f7ecd8",
  risk: "#c04545",
  riskSoft: "#f7e2e2",
};

export const dark: ColorTokens = {
  bg: "#141917",
  surface: "#1c2320",
  ink: "#e8ece9",
  inkSoft: "#b4bdb7",
  inkFaint: "#828c86",
  line: "#2d3733",
  accent: "#34c48f",
  accentInk: "#4fd3a1",
  accentSoft: "#1e332b",
  warn: "#d9a441",
  warnSoft: "#33290f",
  risk: "#e07070",
  riskSoft: "#3a1f1f",
};

/** Adherence signals are the app's core vocabulary — one colour each, both themes. */
export const signalColor = {
  on_track: { light: light.accent, dark: dark.accent },
  needs_attention: { light: light.warn, dark: dark.warn },
  at_risk: { light: light.risk, dark: dark.risk },
} as const;

export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 } as const;

/** 4pt base. Touch targets never go below 44 (PRODUCT_SPEC §9 accessibility). */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const minTouchTarget = 44;

export const fontSize = { xs: 11, sm: 13, base: 15, lg: 18, xl: 22, display: 28 } as const;
