// Calendar-week helpers on local yyyy-mm-dd strings. Pure and dependency-free
// so both server components and client widgets can use them.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a yyyy-mm-dd as a local date (never UTC, so the day never shifts). */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDay(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** A day the URL may carry: well-formed and a real calendar date, else null. */
export function validDay(input: string | undefined): string | null {
  if (!input || !DAY_RE.test(input)) return null;
  const parsed = parseDay(input);
  // "2026-02-31" parses to March 3rd; round-tripping catches that.
  return !Number.isNaN(parsed.getTime()) && formatDay(parsed) === input ? input : null;
}

export function shiftDay(day: string, days: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + days);
  return formatDay(d);
}

/** Monday → Sunday of the week containing `day`. */
export function weekDaysOf(day: string): string[] {
  const d = parseDay(day);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  const monday = formatDay(d);
  return Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
}
