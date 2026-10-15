// Imported by every component test (*.test.tsx, jsdom): the jest-dom matchers
// and the unmount between tests come with it rather than from a global setup file.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup, render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import type { LengthUnit, WeightUnit } from "@healthapp/shared";
import { getDictionary, type Locale } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/client";
import { UnitsProvider } from "@/lib/units/client";

afterEach(cleanup);

/** The dictionary a test asserts against — the same strings the component renders. */
export function dict(locale: Locale = "en") {
  return getDictionary(locale);
}

/** Render inside the providers the app layouts mount (i18n + display units). */
export function renderWithApp(
  ui: ReactElement,
  { locale = "en", weight = "kg", length = "cm", ...options }: { locale?: Locale; weight?: WeightUnit; length?: LengthUnit } & RenderOptions = {},
) {
  return render(
    <I18nProvider locale={locale} dict={getDictionary(locale)}>
      <UnitsProvider weight={weight} length={length}>{ui}</UnitsProvider>
    </I18nProvider>,
    options,
  );
}
