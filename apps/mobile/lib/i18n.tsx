import { fill, formatDecimal, localizeDefaultName, type DefaultNameKind, type Locale } from "@healthapp/i18n";
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
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
    onboarding: onboardingMessages[locale],
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

type I18n = {
  locale: Locale;
  t: Dictionary;
  fill: typeof fill;
  setLocale: (locale: Locale) => void;
  /** A stored default name ("My targets", "Breakfast", "Fat loss", a suggested habit) in the current language; anything typed is returned as is. */
  named: (kind: DefaultNameKind, name: string) => string;
  /** A displayed decimal in the current language: "72,5" in Romanian, "72.5" in English (packages/i18n formatDecimal). */
  num: (value: number, options?: { maxDecimals?: number; minDecimals?: number }) => string;
};
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // The API's language is set before anything renders: a child's first query
  // runs before this provider's effects would, and must not go out in English.
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = deviceLocale();
    setApiLocale(initial);
    return initial;
  });

  useEffect(() => {
    // An explicit choice made in the app outlives the device setting.
    SecureStore.getItemAsync(STORE_KEY)
      .then((saved) => {
        if (saved === "ro" || saved === "en") {
          setApiLocale(saved);
          setLocaleState(saved);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => setApiLocale(locale), [locale]);

  const setLocale = useCallback((next: Locale) => {
    setApiLocale(next);
    setLocaleState(next);
    SecureStore.setItemAsync(STORE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      t: dictionary(locale),
      fill,
      setLocale,
      named: (kind, name) => localizeDefaultName(kind, name, locale),
      num: (n, options) => formatDecimal(n, locale, options),
    }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/**
 * Server answers carry words in the language they were asked in ("3d ago",
 * plan and badge names…), and the query cache keys do not include the
 * language. So when it changes — a choice in Settings, or the saved choice
 * arriving after the first queries went out in the device language — every
 * cached answer is invalidated: the screens on show refetch at once, the rest
 * the next time they open. Rendered once, inside QueryClientProvider.
 */
export function LocaleQuerySync() {
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const first = useRef(locale);
  useEffect(() => {
    if (first.current === locale) return;
    first.current = locale;
    setApiLocale(locale);
    void queryClient.invalidateQueries();
  }, [locale, queryClient]);
  return null;
}
