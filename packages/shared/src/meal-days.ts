// Which planned meals apply on a given weekday.
//
// planned_meals.day_index has meant "0 = every day, 1..7 = specific weekday"
// since the first nutrition migration, but nothing ever wrote anything but 0,
// so every client saw the same four meals on a Monday and on a Sunday. This is
// the rule that makes the column real, and it lives here because the client
// app, the coach's preview and "ate as planned" must all resolve it the same
// way — a plan that shows one thing and logs another is worse than no plan.
//
// Weekdays are ISO: 1 = Monday … 7 = Sunday. Postgres `extract(isodow …)`
// agrees, which matters because the reminder jobs already speak that dialect.

/** ISO weekday (1 = Monday … 7 = Sunday) for a Date or yyyy-mm-dd string. */
export function isoWeekday(day: Date | string): number {
  const d = typeof day === "string" ? new Date(`${day.slice(0, 10)}T00:00:00Z`) : day;
  const dow = typeof day === "string" ? d.getUTCDay() : d.getDay();
  return dow === 0 ? 7 : dow;
}

/**
 * The meals that apply on `weekday`, one per slot: a meal written for that
 * exact day wins over the everyday default, and slots with neither are absent.
 *
 * Ordering within a slot follows `position`, so a coach who adds two overrides
 * for the same slot and day gets the first one — deterministic rather than
 * whichever row the database happened to return.
 */
export function mealsForWeekday<T extends { slot: string; day_index: number; position?: number }>(
  meals: readonly T[],
  weekday: number,
): T[] {
  const bySlot = new Map<string, T>();
  const ordered = [...meals].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const meal of ordered) {
    if (meal.day_index !== 0 && meal.day_index !== weekday) continue;
    const current = bySlot.get(meal.slot);
    // A day-specific meal replaces the everyday one; a second meal of the same
    // specificity does not replace the first.
    if (!current || (current.day_index === 0 && meal.day_index === weekday)) {
      bySlot.set(meal.slot, meal);
    }
  }
  return [...bySlot.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
