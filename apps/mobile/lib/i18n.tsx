import { fill, type Locale } from "@healthapp/i18n";
import { clientAppMessages } from "@healthapp/i18n/messages/client-app";
import { clientWidgetsMessages } from "@healthapp/i18n/messages/client-widgets";
import { coachAppMessages } from "@healthapp/i18n/messages/coach-app";
import { coachWidgetsMessages } from "@healthapp/i18n/messages/coach-widgets";
import { coachProfileMessages } from "@healthapp/i18n/messages/coach-profile";
import { commonMessages } from "@healthapp/i18n/messages/common";
import { gymsMessages } from "@healthapp/i18n/messages/gyms";
import { landingMessages } from "@healthapp/i18n/messages/landing";
import { mobileMessages } from "@healthapp/i18n/messages/mobile";
import { onboardingMessages } from "@healthapp/i18n/messages/onboarding";
import { getLocales } from "expo-localization";
import * as SecureStore from "./secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setApiLocale } from "./api";

// The same strings as the web (packages/i18n), per namespace so the bundle only
// carries what the app shows: `common`, the client screens' `clientApp` and
// `clientWidgets` (the set logger's and the rest timer's words, exactly as on
// the web), and `mobile` (the phone's own).
function dictionary(locale: Locale) {
  return {
    common: commonMessages[locale],
    clientApp: clientAppMessages[locale],
    clientWidgets: clientWidgetsMessages[locale],
    coachApp: coachAppMessages[locale],
    coachWidgets: coachWidgetsMessages[locale],
    gyms: gymsMessages[locale],
    bookings: coachProfileMessages[locale].bookings,
    marketplace: coachProfileMessages[locale].marketplace,
    coachBecome: coachProfileMessages[locale].become,
    coachProfile: coachProfileMessages[locale],
    coachView: onboardingMessages[locale].coachView,
    login: landingMessages[locale].login,
    mobile: mobileMessages[locale],
  };
}
export type Dictionary = ReturnType<typeof dictionary>;

const STORE_KEY = "voinic-locale";

/** The device language when it is Romanian or English, else English (the web's default). */
function deviceLocale(): Locale {
  const code = getLocales()[0]?.languageCode;
  return code === "ro" ? "ro" : "en";
}

type I18n = { locale: Locale; t: Dictionary; fill: typeof fill; setLocale: (locale: Locale) => void };
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(deviceLocale);

  useEffect(() => {
    // An explicit choice made in the app outlives the device setting.
    SecureStore.getItemAsync(STORE_KEY)
      .then((saved) => {
        if (saved === "ro" || saved === "en") setLocaleState(saved);
      })
      .catch(() => {});
  }, []);

  useEffect(() => setApiLocale(locale), [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    SecureStore.setItemAsync(STORE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo(() => ({ locale, t: dictionary(locale), fill, setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
