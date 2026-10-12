// "Open now" for a gym, from Google's regularOpeningHours.periods as stored
// on gyms.opening_periods (20261117100000). Pure: the caller passes the local
// weekday / hour / minute (Europe/Bucharest for a Romanian gym) so nothing
// here reads a clock.
//
// Google's shape: [{ open: { day, hour, minute }, close?: { day, hour, minute } }],
// day 0 = Sunday. A single period with no close means open 24/7. A period may
// run past midnight (close.day ≠ open.day) or wrap around Saturday → Sunday.

export type GymPeriodPoint = { day: number; hour: number; minute: number };
export type GymPeriod = { open?: GymPeriodPoint; close?: GymPeriodPoint };
export type GymOpenState = "open" | "closed" | "unknown";

const WEEK = 7 * 24 * 60;

function minuteOfWeek(p: GymPeriodPoint): number {
  return (((p.day % 7) + 7) % 7) * 1440 + p.hour * 60 + p.minute;
}

function valid(p: GymPeriodPoint | undefined): p is GymPeriodPoint {
  return !!p && [p.day, p.hour, p.minute].every((n) => Number.isInteger(n)) &&
    p.day >= 0 && p.day <= 6 && p.hour >= 0 && p.hour <= 24 && p.minute >= 0 && p.minute < 60;
}

/** day: 0 = Sunday … 6 = Saturday, as Google counts. */
export function gymOpenState(periods: readonly GymPeriod[] | null | undefined, day: number, hour: number, minute: number): GymOpenState {
  if (!periods || periods.length === 0) return "unknown";
  const now = minuteOfWeek({ day, hour, minute });
  for (const p of periods) {
    if (!valid(p.open)) continue;
    if (!p.close) return "open"; // open 24/7
    if (!valid(p.close)) continue;
    const start = minuteOfWeek(p.open);
    let end = minuteOfWeek(p.close);
    if (end <= start) end += WEEK; // past midnight Saturday → Sunday
    const t = now < start ? now + WEEK : now;
    if (t >= start && t < end) return "open";
  }
  return "closed";
}
