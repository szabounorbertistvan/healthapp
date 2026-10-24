import { fill, type Dictionary } from "./i18n";
import type { DashboardRow } from "./types";

// Shared by the coach dashboard page and the app's GET /api/v1/coach/dashboard,
// so the web and the phone explain a signal in the same words.

/** The row's "why" in the reader's language; the snapshot's English only when the live read failed. */
export function whyText(r: DashboardRow, d: Dictionary["coachApp"]["dashboard"]): string {
  const f = r.facts;
  if (!f) return r.reason;
  const line = fill(d.why, {
    completed: f.completed, target: f.target, days: f.daysLogged, habits: f.habitsPct,
    checkin: f.checkin ? d.whyCheckinDone : d.whyCheckinMissed,
  });
  return f.stalledDays === null ? line : line + fill(d.whyStalled, { days: f.stalledDays });
}
