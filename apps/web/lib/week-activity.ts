// The week's activity folded from its rows — the pure half of
// lib/live-adherence (which reads the rows for Today and for the coach), split
// out so the calendar rule can be tested without a request.
import { localDay, shiftDays, weekStartOf } from "@healthapp/shared";

/** A person's zone and the day it is there now (lib/my-today builds it for the signed-in one). */
export type Calendar = { today: string; timeZone: string };

/** The raw rows the week is folded from. */
export type ActivityRows = {
  sessions: readonly { program_day_id: string | null; completed_at: string | null; started_at: string }[];
  foods: readonly { date: string; kcal: number | null; received_at: string | null }[];
  habitLogs: readonly { received_at: string | null }[];
  /** received_at of logged sets — the newest is enough. */
  setStamps: readonly (string | null)[];
};

/** Everything the adherence engine and the Today header need about the week. */
export type WeekActivity = {
  completedSessions: number;
  daysLogged: number;
  weekKcal: { kcal: number }[];
  lastActivity: string | null;
  /** Program days already trained this week, by id. */
  doneDays: Set<string>;
};

/**
 * The week's activity from its rows, on the CLIENT's calendar: their Monday,
 * their today, a session counted on the day it finished where they live. Both
 * Today and the coach's screens pass the client's own zone, so the two still
 * fold the same rows the same way. Pure; the window each caller fetched only
 * has to cover the week.
 */
export function foldActivity(rows: ActivityRows, calendar: Calendar): WeekActivity {
  const weekStart = weekStartOf(calendar.today);
  const done = rows.sessions.filter(
    (s) => s.completed_at !== null && localDay(s.completed_at, calendar.timeZone) >= weekStart,
  );

  // kcal per day over the last 7, days with nothing logged left out — the
  // shape macroScore() expects.
  const weekFrom = shiftDays(calendar.today, -6);
  const kcalByDay = new Map<string, number>();
  for (const f of rows.foods) {
    if (f.date < weekFrom) continue;
    kcalByDay.set(f.date, (kcalByDay.get(f.date) ?? 0) + Number(f.kcal ?? 0));
  }

  const stamps = [
    ...rows.foods.map((f) => f.received_at),
    ...rows.habitLogs.map((h) => h.received_at),
    ...rows.setStamps,
  ].filter((s): s is string => Boolean(s));

  return {
    completedSessions: done.length,
    daysLogged: kcalByDay.size,
    weekKcal: [...kcalByDay.values()].filter((kcal) => kcal > 0).map((kcal) => ({ kcal })),
    lastActivity: stamps.length > 0 ? (stamps.sort().at(-1) ?? null) : null,
    doneDays: new Set(done.map((s) => s.program_day_id).filter((id): id is string => id !== null)),
  };
}

/**
 * The next workout of the followed program: the first day, in program order,
 * with no completed session this week — or the first day again once all of
 * them are done. One rule for Today's "next workout" card and the Training
 * list's "next" marker, so the two never point at different days.
 */
export function nextWorkoutDay<T extends { day_id: string }>(days: readonly T[], doneDays: ReadonlySet<string>): T | null {
  return days.find((d) => !doneDays.has(d.day_id)) ?? days[0] ?? null;
}
