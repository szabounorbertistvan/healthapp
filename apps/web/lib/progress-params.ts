// The /progress dashboard keeps its state in the URL — range, tab, chosen
// exercise — so every view is a server render of the person's own rows and a
// link can be shared or reloaded. Pure, so the parser that guards the query
// can be tested without a request.
import type { ProgressRange } from "@healthapp/shared";

export type ProgressTab = "body" | "strength" | "consistency";
export const PROGRESS_TABS: readonly ProgressTab[] = ["body", "strength", "consistency"];

export type ProgressState = { range: ProgressRange; tab: ProgressTab; exercise: string | null };

const DEFAULT: ProgressState = { range: 30, tab: "body", exercise: null };
const RANGES: Record<string, ProgressRange> = { "7": 7, "30": 30, "90": 90, "365": 365, all: null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Anything the URL carries that is not a known value falls back to the default. */
export function parseProgressParams(raw: Raw): ProgressState {
  const range = first(raw.range);
  const tab = first(raw.tab);
  const exercise = first(raw.exercise);
  return {
    range: range !== undefined && range in RANGES ? RANGES[range]! : DEFAULT.range,
    tab: PROGRESS_TABS.includes(tab as ProgressTab) ? (tab as ProgressTab) : DEFAULT.tab,
    exercise: exercise !== undefined && UUID.test(exercise) ? exercise : null,
  };
}

/** The URL for a state, leaving defaults out so the plain /progress stays plain. */
export function progressHref(state: ProgressState): string {
  const q = new URLSearchParams();
  if (state.range !== DEFAULT.range) q.set("range", state.range === null ? "all" : String(state.range));
  if (state.tab !== DEFAULT.tab) q.set("tab", state.tab);
  if (state.exercise) q.set("exercise", state.exercise);
  const s = q.toString();
  return s ? `/progress?${s}` : "/progress";
}
