/**
 * Colour theme. Dark is the brand and the default; light is an explicit
 * opt-in stored in a cookie (same pattern as the locale cookie) so the server
 * can render `data-theme` on <html> and there is never a flash of the wrong
 * palette. We deliberately do not follow `prefers-color-scheme`.
 *
 * This file is client-safe (constants only); the cookie read lives in
 * `theme-server.ts` because `next/headers` cannot be bundled into client code.
 */
export const themes = ["dark", "light"] as const;
export type Theme = (typeof themes)[number];
export const defaultTheme: Theme = "dark";

export const THEME_COOKIE = "bg-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isTheme(value: string | undefined | null): value is Theme {
  return value === "dark" || value === "light";
}
