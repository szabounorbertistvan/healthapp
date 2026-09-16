// Display units.
//
// Everything is STORED metric — logged_sets.weight_kg, measurements.weight_kg,
// circumferences in cm — and converted only at the edges: once on the way to a
// screen, once on the way back from an input. Storing what the person typed
// would mean every sum, chart and leaderboard had to know which unit each row
// was in, and a single missed conversion would put pounds into a kilogram
// total without anything looking wrong.
//
// users.weight_unit / length_unit have existed since the first migration with
// nothing reading them, which is why this module arrives late.

export type WeightUnit = "kg" | "lb";
export type LengthUnit = "cm" | "in";

const LB_PER_KG = 2.2046226218487757;
const CM_PER_IN = 2.54;

/** Gym plates come in half-kilo steps, so one decimal is the honest precision. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function kgToDisplay(kg: number, unit: WeightUnit): number {
  return round1(unit === "lb" ? kg * LB_PER_KG : kg);
}

/** Back to kilograms for storage. Unrounded: the rounding belongs to display. */
export function displayToKg(value: number, unit: WeightUnit): number {
  return unit === "lb" ? value / LB_PER_KG : value;
}

export function cmToDisplay(cm: number, unit: LengthUnit): number {
  return round1(unit === "in" ? cm / CM_PER_IN : cm);
}

export function displayToCm(value: number, unit: LengthUnit): number {
  return unit === "in" ? value * CM_PER_IN : value;
}

/**
 * A weight for reading: converted, rounded, with its unit.
 *
 * Large totals — session volume, a month of lifting — lose the decimal and gain
 * thousands separators, because "12,480 kg" is a number someone can hold in
 * their head and "12480.3 kg" is not.
 */
export function formatWeight(
  kg: number | null | undefined,
  unit: WeightUnit,
  options: { locale?: string; big?: boolean } = {},
): string {
  if (kg === null || kg === undefined || Number.isNaN(kg)) return "—";
  const value = kgToDisplay(kg, unit);
  const big = options.big ?? Math.abs(value) >= 1000;
  const text = big
    ? Math.round(value).toLocaleString(options.locale ?? "en")
    : String(value);
  return `${text} ${unit}`;
}

export function formatLength(
  cm: number | null | undefined,
  unit: LengthUnit,
): string {
  if (cm === null || cm === undefined || Number.isNaN(cm)) return "—";
  return `${cmToDisplay(cm, unit)} ${unit}`;
}

export function isWeightUnit(x: unknown): x is WeightUnit {
  return x === "kg" || x === "lb";
}

export function isLengthUnit(x: unknown): x is LengthUnit {
  return x === "cm" || x === "in";
}
