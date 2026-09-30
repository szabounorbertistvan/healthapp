// Text for an achievement, from the catalog's metric + target and the i18n
// dictionary. Pure and framework-free on purpose: the list is a client
// component and the detail page a server one, and a helper exported from a
// "use client" file throws when a server component calls it.
import { achievementProgress, isAchievementMetric, metricUnit, type AchievementProgress } from "@healthapp/shared";
import type { Dictionary } from "./i18n";
import type { Locale } from "./i18n/config";
import { fill } from "./i18n";

type Strings = Dictionary["common"]["achievements"];

export function numberFormat(locale: Locale): Intl.NumberFormat {
  return new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 1 });
}

/** "Complete 100 workouts." — or the "first" wording when the target is 1. */
export function requirementText(a: Strings, metric: string, target: number, locale: Locale): string {
  if (!isAchievementMetric(metric)) return "";
  if (target === 1 && metric in a.requirementFirst) {
    return a.requirementFirst[metric as keyof Strings["requirementFirst"]];
  }
  return fill(a.requirement[metric], { target: numberFormat(locale).format(target) });
}

/** How the metric is counted, for the detail view. */
export function metricExplanation(a: Strings, metric: string): string {
  return isAchievementMetric(metric) ? a.metric[metric] : "";
}

export function unitLabel(a: Strings, metric: string): string {
  return isAchievementMetric(metric) ? a.units[metricUnit(metric)] : "";
}

export type ProgressText = AchievementProgress & { line: string; remainingLine: string | null };

/** "742.500 / 1.000.000 kg" and "257.500 kg to go", localised. */
export function progressText(a: Strings, metric: string, current: number, target: number, locale: Locale): ProgressText {
  const p = achievementProgress(current, target);
  const nf = numberFormat(locale);
  const unit = unitLabel(a, metric);
  return {
    ...p,
    // An earned badge reads "1 / 1", not "6 / 1": past the target, the count
    // beyond it is not progress towards anything. p.current keeps the truth.
    line: fill(a.progress, { current: nf.format(p.complete ? Math.min(p.current, p.target) : p.current), target: nf.format(p.target), unit }).trim(),
    remainingLine: p.complete ? null : fill(a.remaining, { remaining: nf.format(p.remaining), unit }).trim(),
  };
}
