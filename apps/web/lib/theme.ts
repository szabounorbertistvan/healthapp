/**
 * Colour theme. Three states:
 *
 *  - "system" (the default): follow the device — `prefers-color-scheme` decides,
 *    so a phone that flips to dark at sunset takes the app with it.
 *  - "dark" / "light": an explicit override, stored in a cookie (same pattern as
 *    the locale cookie) so the server can stamp `data-theme` on <html> and
 *    there is never a flash of the wrong palette.
 *
 * With no override the server renders no `data-theme` at all and the CSS media
 * query in globals.css picks the palette. Dark remains the brand look and the
 * fallback for browsers that report no preference.
 *
 * This file is client-safe (constants only); the cookie read lives in
 * `theme-server.ts` because `next/headers` cannot be bundled into client code.
 */
export const themes = ["system", "dark", "light"] as const;
export type Theme = (typeof themes)[number];
export const defaultTheme: Theme = "system";

export const THEME_COOKIE = "bg-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isTheme(value: string | undefined | null): value is Theme {
  return value === "system" || value === "dark" || value === "light";
}

/** The next state when the toggle is pressed: system → dark → light → system. */
export function nextTheme(current: Theme): Theme {
  const index = themes.indexOf(current);
  return themes[(index + 1) % themes.length];
}
