"use client";
import { createContext, useContext } from "react";
import type { Dictionary, Locale } from "./index";

const I18nContext = createContext<{ locale: Locale; t: Dictionary } | null>(null);

export function I18nProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  children: React.ReactNode;
}) {
  return <I18nContext.Provider value={{ locale, t: dict }}>{children}</I18nContext.Provider>;
}

/** Client-component entry point: `const { t, locale } = useI18n();` */
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
