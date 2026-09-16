// Turning a list of dated events into "per week, for the last N weeks".
//
// Lives here rather than in a chart component because two screens must never
// disagree about which Monday a Sunday-night session belongs to. Weeks start on
// Monday, matching mondayOf() in the web app and date_trunc('week', …) in SQL,
// which is also Monday in Postgres.

export type WeekBucket = {
  /** Monday of the bucket, yyyy-mm-dd. */
  week_start: string;
  value: number;
  /** How many events landed in this week — a bar of 0 from no sessions and a
      bar of 0 from a session with no volume are different facts. */
  count: number;
};

/** Monday of the week containing `iso`, as yyyy-mm-dd. */
export function weekStartOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  // getUTCDay: 0 = Sunday. Shift so Monday = 0.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Sum `value` per week over the `weeks` weeks ending with the week containing
 * `today`. Empty weeks are kept — a gap in training is the most interesting
 * thing a volume chart can show, and dropping it would draw a flat line over a
 * month off.
 */
export function weeklyTotals(
  events: readonly { at: string; value: number }[],
  weeks = 12,
  today: Date = new Date(),
): WeekBucket[] {
  const end = weekStartOf(today.toISOString());
  const buckets: WeekBucket[] = [];
  const index = new Map<string, number>();

  const cursor = new Date(`${end}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - (weeks - 1) * 7);
  for (let i = 0; i < weeks; i++) {
    const key = cursor.toISOString().slice(0, 10);
    index.set(key, buckets.length);
    buckets.push({ week_start: key, value: 0, count: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  for (const event of events) {
    const slot = index.get(weekStartOf(event.at));
    if (slot === undefined) continue; // older than the window, or in the future
    buckets[slot]!.value += event.value;
    buckets[slot]!.count += 1;
  }
  return buckets;
}
