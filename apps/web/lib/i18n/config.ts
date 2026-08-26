export const locales = ["en", "ro"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

// One year — a language choice should outlive the auth session.
export const LOCALE_COOKIE = "bg-locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "en" || value === "ro";
}
