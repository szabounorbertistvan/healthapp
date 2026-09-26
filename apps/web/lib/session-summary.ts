// One completed session as the history list, Today and the Progress headline
// read it. Split out of client-training.ts ("server-only") so the volume rule
// can be tested: `volume_kg` is rounded for display, as it always was, and
// `volume_exact_kg` carries the unrounded sum for totals — adding up rounded
// sessions drifts a kilogram or two from the exact figure the Progress tabs
// show beside it.
import { totalVolume } from "@healthapp/shared";
import { loadOf, toLoadSet, type LoadSetJoin } from "./training-load";
import type { SessionSummaryRow } from "./types";

export type SessionSummaryJoin = {
  id: string;
  program_day_id: string | null;
  started_at: string;
  completed_at: string | null;
  day: { name: string } | null;
  logged_sets: (LoadSetJoin & { is_pr: boolean | null })[] | null;
};

export function toSessionSummary(s: SessionSummaryJoin): SessionSummaryRow {
  const sets = s.logged_sets ?? [];
  const exact = totalVolume(sets.map((x) => ({ weight_kg: x.weight_kg ?? 0, reps: x.reps ?? 0 })));
  return {
    id: s.id,
    day_id: s.program_day_id,
    day_name: s.day?.name ?? "Session",
    at: s.completed_at ?? s.started_at,
    sets: sets.length,
    volume_kg: Math.round(exact),
    volume_exact_kg: exact,
    prs: sets.filter((x) => x.is_pr).length,
    load: loadOf(sets.map(toLoadSet), s.started_at, s.completed_at),
  };
}
