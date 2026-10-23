// The Romanian + English strings of every Voinic surface — the web (apps/web)
// and the Android app (apps/mobile) read the same files. Plain objects, no
// runtime imports, so any bundler can take them. Every string goes into both
// `en` and `ro` of its namespace file; the types enforce the parity.
import type { Locale } from "./config";
import { commonMessages } from "./messages/common";
import { landingMessages } from "./messages/landing";
import { clientAppMessages } from "./messages/client-app";
import { clientWidgetsMessages } from "./messages/client-widgets";
import { coachAppMessages } from "./messages/coach-app";
import { coachWidgetsMessages } from "./messages/coach-widgets";
import { adminMessages } from "./messages/admin";
import { coachProfileMessages } from "./messages/coach-profile";
import { gymsMessages } from "./messages/gyms";
import { onboardingMessages } from "./messages/onboarding";

export function getDictionary(locale: Locale) {
  return {
    common: commonMessages[locale],
    landing: landingMessages[locale].landing,
    login: landingMessages[locale].login,
    getApp: landingMessages[locale].getApp,
    clientApp: clientAppMessages[locale],
    clientWidgets: clientWidgetsMessages[locale],
    coachApp: coachAppMessages[locale],
    coachWidgets: coachWidgetsMessages[locale],
    admin: adminMessages[locale],
    coachProfile: coachProfileMessages[locale],
    gyms: gymsMessages[locale],
    onboarding: onboardingMessages[locale],
  };
}

export type Dictionary = ReturnType<typeof getDictionary>;

/** Fill {placeholders} in a message: fill(t.time.daysAgo, { days: 3 }) */
export function fill(message: string, values: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (m, key) =>
    key in values ? String(values[key]) : m,
  );
}

export { locales, defaultLocale, isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "./config";
export type { Locale } from "./config";
