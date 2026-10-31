// Unfinished sessions from an earlier day — the rows behind Today's
// "you left a workout open" notice. Pure, so the web and /api/v1 fold the same
// rows the same way (lib/client-training.ts reads them).
import { localDay } from "@healthapp/shared";
import type { OpenSession } from "./types";

export type OpenSessionJoin = {
  id: string;
  program_day_id: string | null;
  started_at: string;
  day: { name: string | null } | { name: string | null }[] | null;
  logged_sets: { count: number }[] | null;
};

/**
 * Sessions that have sets, started before `today` on the person's calendar —
 * today's own session is simply in progress, not forgotten. Newest first.
 */
export function openPastSessions(rows: readonly OpenSessionJoin[], today: string, timeZone: string): OpenSession[] {
  return rows
    .map((r) => {
      const day = Array.isArray(r.day) ? r.day[0] ?? null : r.day;
      return {
        id: r.id,
        day_id: r.program_day_id,
        day_name: day?.name ?? null,
        started_at: r.started_at,
        day: localDay(r.started_at, timeZone),
        set_count: r.logged_sets?.[0]?.count ?? 0,
      };
    })
    .filter((s) => s.set_count > 0 && s.day < today)
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
}

/**
 * When a forgotten session ended: its last set (the client's own clock when
 * the set carries one — an outbox replay arrives later than it was lifted —
 * else the server's), never before it started and never in the future.
 * The SQL engine's close_stale_sessions() (20261211110000) stamps the same.
 */
export function sessionEndAt(
  startedAt: string,
  sets: readonly { client_ts: string | null; received_at: string }[],
  now: Date = new Date(),
): string | null {
  const stamps = sets.map((s) => Date.parse(s.client_ts ?? s.received_at)).filter(Number.isFinite);
  if (stamps.length === 0) return null;
  const started = Date.parse(startedAt);
  const last = Math.max(...stamps);
  return new Date(Math.max(Number.isFinite(started) ? started : last, Math.min(now.getTime(), last))).toISOString();
}
