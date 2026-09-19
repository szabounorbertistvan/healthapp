import type { RestTimer, RestTimerStatus } from "@healthapp/shared";

// Where the running rest lives between renders, routes and reloads. The
// entry is the timer as-is — two instants and a status — so a page that
// comes back from a locked phone rebuilds the countdown from `endsAt`, never
// from how long the tab happened to be awake. No set data is stored: the
// exercise name and set number are display context, nothing more.

export const REST_TIMER_STORAGE_KEY = "voinic-rest-timer-v1";

/** A finished rest older than this is history, not a completion worth announcing. */
const STALE_AFTER_MS = 30 * 60 * 1000;

const STATUSES: readonly RestTimerStatus[] = ["idle", "running", "paused", "completed", "skipped"];

/** The three Storage methods used — localStorage, or a stand-in in tests. */
export type RestTimerStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadRestTimer(store: RestTimerStore, now = Date.now()): RestTimer | null {
  let raw: string | null;
  try {
    raw = store.getItem(REST_TIMER_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RestTimer>;
    if (!isRestTimer(parsed)) return null;
    if (now - parsed.endsAt > STALE_AFTER_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveRestTimer(store: RestTimerStore, timer: RestTimer | null): void {
  try {
    if (timer) store.setItem(REST_TIMER_STORAGE_KEY, JSON.stringify(timer));
    else store.removeItem(REST_TIMER_STORAGE_KEY);
  } catch {
    // storage unavailable (private mode, quota) — the in-memory timer still runs
  }
}

function isRestTimer(value: Partial<RestTimer>): value is RestTimer {
  return (
    typeof value.id === "string" &&
    typeof value.status === "string" && STATUSES.includes(value.status) &&
    typeof value.startedAt === "number" && Number.isFinite(value.startedAt) &&
    typeof value.endsAt === "number" && Number.isFinite(value.endsAt) &&
    typeof value.durationSeconds === "number" &&
    typeof value.context === "object" && value.context !== null &&
    typeof value.context.dayId === "string"
  );
}
