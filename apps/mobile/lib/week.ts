// Calendar helpers for the dashboard — the web's lib/week.ts (parseDay,
// weekDaysOf), pure and tested in week.test.ts. An ISO day is a calendar date
// with no time zone; it is built and read in local time so it never shifts.

/** "2026-10-24" → a local Date at noon (noon: no DST edge can move the day). */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 12);
}

function isoOf(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Monday → Sunday of the week the day is in (ISO weeks, as the web's). */
export function weekDaysOf(iso: string): string[] {
  const day = parseDay(iso);
  const fromMonday = (day.getDay() + 6) % 7;
  const monday = new Date(day);
  monday.setDate(day.getDate() - fromMonday);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return isoOf(d);
  });
}

/** "saturday" → "Saturday" — the web's first-letter:uppercase. */
export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}
