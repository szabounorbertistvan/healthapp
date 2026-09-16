"use client";
import { createContext, useContext } from "react";
import {
  formatLength, formatWeight, kgToDisplay, cmToDisplay,
  type LengthUnit, type WeightUnit,
} from "@healthapp/shared";
import { useI18n } from "@/lib/i18n/client";

/**
 * The signed-in person's display units, shaped like the i18n provider so the
 * call sites read the same: `const u = useUnits();` then `u.weight(kg)`.
 *
 * Metric is the default rather than a missing value, because a component can
 * render before any profile is known and "kg" is what the database already
 * holds — so the fallback shows the stored number unconverted rather than a
 * converted-looking wrong one.
 */
const UnitsContext = createContext<{ weight: WeightUnit; length: LengthUnit }>({
  weight: "kg",
  length: "cm",
});

export function UnitsProvider({
  weight,
  length,
  children,
}: {
  weight: WeightUnit;
  length: LengthUnit;
  children: React.ReactNode;
}) {
  return <UnitsContext.Provider value={{ weight, length }}>{children}</UnitsContext.Provider>;
}

export function useUnits() {
  const { weight, length } = useContext(UnitsContext);
  const { locale } = useI18n();
  return {
    weightUnit: weight,
    lengthUnit: length,
    /** "82.5 kg" / "181.9 lb"; totals over a thousand lose the decimal. */
    weight: (kg: number | null | undefined, options?: { big?: boolean }) =>
      formatWeight(kg, weight, { locale, big: options?.big }),
    length: (cm: number | null | undefined) => formatLength(cm, length),
    /** The bare converted number, for charts and inputs that print their own unit. */
    weightValue: (kg: number) => kgToDisplay(kg, weight),
    lengthValue: (cm: number) => cmToDisplay(cm, length),
  };
}
