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

// ---------- categories ----------

/**
 * The order the lists show habits in: what you eat, how you move, how you
 * recover, then whatever the person wrote themselves. `habits` has no
 * category column, so a category is recovered from the suggestion the name
 * matches — a custom habit is "own".
 */
export const HABIT_CATEGORIES = ["nutrition", "movement", "recovery", "own"] as const;

export type HabitCategory = (typeof HABIT_CATEGORIES)[number];

const CATEGORY_OF: Record<HabitSuggestionKey, Exclude<HabitCategory, "own">> = {
  water: "nutrition", protein: "nutrition", vegetables: "nutrition",
  steps: "movement", stretching: "movement",
  sleep: "recovery", meditation: "recovery",
};

export function habitCategory(name: string): HabitCategory {
  const key = suggestionKeyForName(name);
  return key ? CATEGORY_OF[key] : "own";
}

/** The rows bucketed in HABIT_CATEGORIES order; empty categories are left out. */
export function groupHabitsByCategory<T extends { name: string }>(
  rows: T[],
): { category: HabitCategory; habits: T[] }[] {
  const buckets = new Map<HabitCategory, T[]>(HABIT_CATEGORIES.map((c) => [c, []]));
  for (const row of rows) buckets.get(habitCategory(row.name))!.push(row);
  return HABIT_CATEGORIES.flatMap((category) => {
    const habits = buckets.get(category)!;
    return habits.length > 0 ? [{ category, habits }] : [];
  });
}
