import "server-only";

// Local calendar dates as yyyy-mm-dd.
//
// Everything user-facing in this app is a *local* day: "did you train today",
// "which Monday does this week start on". Using toISOString() directly would
// answer in UTC and silently move the boundary for anyone east or west of it,
// so the offset is subtracted first. These moved here when lib/demo-client-store
// went away with demo mode — they were never demo-specific.

export function isoDay(d: Date = new Date()): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

export function daysAgoStamp(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/** Monday of the week containing today, offset by whole weeks. */
export function mondayOf(weeksBack = 0): string {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow - weeksBack * 7);
  return isoDay(d);
}

export function daysSince(iso: string | null): number {
  if (!iso) return 99;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

