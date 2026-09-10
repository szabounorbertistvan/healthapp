import { clientWidgetsMessages } from "./i18n/messages/client-widgets";

// Seven starter habits, each with a short "what" and "why" in both languages
// (lib/i18n/messages/client-widgets.ts → habitSuggestions). Seven on purpose:
// enough to cover water, movement, sleep, mind, mobility and food without
// turning the picker into a catalogue.
export const HABIT_SUGGESTION_KEYS = [
  "water", "steps", "sleep", "meditation", "stretching", "protein", "vegetables",
] as const;

export type HabitSuggestionKey = (typeof HABIT_SUGGESTION_KEYS)[number];

/** Days per week each suggestion defaults to. Daily habits are daily; stretching gives rest days. */
export const HABIT_SUGGESTION_DAYS: Record<HabitSuggestionKey, number> = {
  water: 7, steps: 7, sleep: 7, meditation: 7, stretching: 5, protein: 7, vegetables: 7,
};

/**
 * A habit saved from a suggestion keeps only its name (habits has no `kind`
 * column), so the description is recovered by matching that name in either
 * language. Null for a habit the person wrote themselves.
 */
export function suggestionKeyForName(name: string): HabitSuggestionKey | null {
  const wanted = name.trim().toLowerCase();
  for (const key of HABIT_SUGGESTION_KEYS) {
    for (const locale of ["en", "ro"] as const) {
      if (clientWidgetsMessages[locale].habitSuggestions[key].name.toLowerCase() === wanted) {
        return key;
      }
    }
  }
  return null;
}
