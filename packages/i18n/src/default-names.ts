import type { Locale } from "./config";
import { clientAppMessages } from "./messages/client-app";
import { coachProfileMessages } from "./messages/coach-profile";
import { suggestionKeyForName } from "./habit-suggestions";
import { clientWidgetsMessages } from "./messages/client-widgets";

/**
 * Names the app writes for the person — the own plan ("My targets"), the four
 * default meal slots ("Breakfast"…), the setup goal ("Fat loss"), a habit picked
 * from the suggestions — are stored as words, in whatever language the app was
 * in at that moment. Shown back, they follow the current language: a stored
 * name that equals one of those defaults in *either* language is replaced by
 * the same default in `locale`. Anything the person typed themselves (no match)
 * is returned untouched. Nothing is rewritten in the database.
 */
export type DefaultNameKind = "plan" | "meal" | "goal" | "habit";

const MEAL_KEYS = ["breakfast", "lunch", "dinner", "snack"] as const;
const LOCALES = ["en", "ro"] as const;

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The key of a known default name, in either language, or null. */
function matchKey<K extends string>(name: string, keys: readonly K[], word: (locale: Locale, key: K) => string): K | null {
  for (const key of keys) {
    for (const locale of LOCALES) if (same(word(locale, key), name)) return key;
  }
  return null;
}

const GOAL_KEYS = Object.keys(coachProfileMessages.en.expertise.goals) as (keyof typeof coachProfileMessages.en.expertise.goals)[];

export function localizeDefaultName(kind: DefaultNameKind, name: string, locale: Locale): string;
export function localizeDefaultName(kind: DefaultNameKind, name: string | null, locale: Locale): string | null;
export function localizeDefaultName(kind: DefaultNameKind, name: string | null | undefined, locale: Locale): string | null | undefined {
  if (!name) return name;
  switch (kind) {
    case "plan": {
      const word = (l: Locale) => clientAppMessages[l].nutritionTargets.ownPlanName;
      return LOCALES.some((l) => same(word(l), name)) ? word(locale) : name;
    }
    case "meal": {
      const key = matchKey(name, MEAL_KEYS, (l, k) => clientAppMessages[l].food[k]);
      return key ? clientAppMessages[locale].food[key] : name;
    }
    case "goal": {
      const key = matchKey(name, GOAL_KEYS, (l, k) => coachProfileMessages[l].expertise.goals[k]);
      return key ? coachProfileMessages[locale].expertise.goals[key] : name;
    }
    case "habit": {
      const key = suggestionKeyForName(name);
      return key ? clientWidgetsMessages[locale].habitSuggestions[key].name : name;
    }
  }
}
