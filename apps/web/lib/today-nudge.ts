import { atRiskCause } from "@healthapp/shared";
import { daysSince } from "./dates";
import { pct, timeAgo } from "./format";
import { fill, type Dictionary, type Locale } from "./i18n";
import type { ClientToday } from "./types";

/**
 * The at-risk line under the week's score, in the reader's language — shared by
 * the Today page and the app's GET /api/v1/dashboard so both say the same thing.
 * At risk has two causes and they need different words (BUG-10): a stalled
 * week gets "one set is enough to restart"; an active week whose % is low (a
 * workout done, food / habits / check-in still open) says what is open.
 */
export function todayNudge(today: ClientToday, d: Dictionary["clientApp"]["today"], locale: Locale): string | null {
  const { adherence, habits, last_activity: last } = today;
  const cause = atRiskCause(adherence.signal, daysSince(last));
  const open = [
    adherence.workout < 1 ? d.openWorkouts : null,
    adherence.nutrition < 1 ? d.openFood : null,
    habits.length > 0 && adherence.habits < 1 ? d.openHabits : null,
    !adherence.checkin ? d.openCheckIn : null,
  ].filter((p): p is string => p !== null);
  if (cause === "stalled") return fill(today.has_coach ? d.atRiskBody : d.atRiskBodySolo, { time: timeAgo(last, locale) });
  if (cause === "score") {
    return fill(today.has_coach ? d.atRiskScoreBody : d.atRiskScoreBodySolo, {
      score: pct(adherence.overall),
      open: new Intl.ListFormat(locale, { type: "conjunction" }).format(open.length > 0 ? open : [d.openFood]),
    });
  }
  return null;
}
