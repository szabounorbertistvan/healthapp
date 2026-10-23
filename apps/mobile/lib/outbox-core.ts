import type { CheckInSubmitV1, FoodLogV1, HabitDoneV1, LogSetV1 } from "@healthapp/api/v1";

// The phone's outbox — the native counterpart of the web's lib/offline/outbox.ts,
// with one difference: here *every* write of these kinds goes through it. The
// app saves the write on the phone first (so it shows at once, signal or not),
// then the outbox sends it to /api/v1, i.e. through the web's own action:
//
//   set      POST /sets          logSet()        keys derived from the set itself
//   food     POST /food/logs     logFood()       the phone's clientId → one row
//   habit    POST /habits/done   setHabitDone()  a state, not a toggle
//   checkin  POST /check-in      submitCheckIn() ALREADY_CHECKED_IN counts as done
//
// Each of those is safe to deliver twice, which is the whole point: a write
// whose answer was lost with the signal is simply sent again.
//
// Pure: storage and sending are passed in, so the rules are tested in node
// (outbox-core.test.ts) and lib/outbox.tsx only wires the real ones.

export type OutboxPayload =
  | { kind: "set"; input: LogSetV1 }
  | { kind: "food"; input: FoodLogV1 }
  | { kind: "habit"; input: HabitDoneV1 }
  | { kind: "checkin"; input: CheckInSubmitV1 };

export type QueuedItem = OutboxPayload & {
  /** Local id; for food it is also the server's clientId. */
  id: string;
  /** Who wrote it: replayed only while that same person is signed in. */
  userId: string;
  queuedAt: string;
  /** The server answered and refused it: kept for the person to see, never retried. */
  error?: string | null;
};

export type QueuedSet = Extract<QueuedItem, { kind: "set" }>;
export type QueuedFood = Extract<QueuedItem, { kind: "food" }>;
export type QueuedHabit = Extract<QueuedItem, { kind: "habit" }>;

export type OutboxStore = {
  load(): Promise<QueuedItem[]>;
  save(items: QueuedItem[]): Promise<void>;
};

/** What one send came back with. Only "ok" and "refused" are answers; the rest mean "later". */
export type SendOutcome =
  | { kind: "ok"; isPr: boolean }
  | { kind: "refused"; message: string }
  | { kind: "offline" }
  | { kind: "unauthorized" };

export type FlushResult = {
  synced: { item: QueuedItem; isPr: boolean }[];
  refused: QueuedItem[];
  /** Why the flush stopped early, if it did. */
  stoppedBy: "offline" | "unauthorized" | null;
};

/** Store records from before the outbox had kinds were sets. */
function normalize(item: QueuedItem | (Omit<QueuedSet, "kind"> & { kind?: undefined })): QueuedItem {
  return item.kind ? item : ({ ...item, kind: "set" } as QueuedSet);
}

export async function loadItems(store: OutboxStore): Promise<QueuedItem[]> {
  return (await store.load()).map(normalize);
}

export async function enqueue(store: OutboxStore, item: QueuedItem): Promise<void> {
  const items = await loadItems(store);
  if (items.some((i) => i.id === item.id)) return;
  await store.save([...items, item]);
}

/** When the write happened: a set's own time, otherwise when it was queued. */
function happenedAt(item: QueuedItem): string {
  return item.kind === "set" ? item.input.loggedAt : item.queuedAt;
}

/**
 * Send the signed-in person's waiting writes, oldest first, one at a time
 * (a set opens its session; a habit ticked then unticked must land in that
 * order). Stops at the first "later" outcome — no signal now means no signal
 * for the next one either — and leaves everything not answered where it was.
 */
export async function flushOutbox(
  store: OutboxStore,
  userId: string,
  send: (payload: OutboxPayload, id: string) => Promise<SendOutcome>,
): Promise<FlushResult> {
  const result: FlushResult = { synced: [], refused: [], stoppedBy: null };
  const pending = (await loadItems(store))
    .filter((i) => i.userId === userId && !i.error)
    .sort((a, b) => happenedAt(a).localeCompare(happenedAt(b)) || a.queuedAt.localeCompare(b.queuedAt));

  for (const item of pending) {
    const outcome = await send(item, item.id);
    if (outcome.kind === "offline" || outcome.kind === "unauthorized") {
      result.stoppedBy = outcome.kind;
      break;
    }
    // Re-read before each write: a write queued while this flush runs must survive it.
    const now = await loadItems(store);
    if (outcome.kind === "ok") {
      await store.save(now.filter((i) => i.id !== item.id));
      result.synced.push({ item, isPr: outcome.isPr });
    } else {
      const refused = { ...item, error: outcome.message || "refused" } as QueuedItem;
      await store.save(now.map((i) => (i.id === item.id ? refused : i)));
      result.refused.push(refused);
    }
  }
  return result;
}

/** The person's sets still waiting (or refused) for one training day. */
export function queuedForDay(items: readonly QueuedItem[], userId: string, dayId: string): QueuedSet[] {
  return items.filter((i): i is QueuedSet => i.kind === "set" && i.userId === userId && i.input.dayId === dayId);
}

/** The person's food logs still on the phone for one diary day. */
export function queuedFoodFor(items: readonly QueuedItem[], userId: string, day: string): QueuedFood[] {
  return items.filter((i): i is QueuedFood => i.kind === "food" && i.userId === userId && i.input.day === day);
}

/**
 * A habit's tick as the person last set it on this phone, for the day — what
 * the screen shows over the server's answer until the outbox has delivered it.
 * Undefined when nothing for it is waiting.
 */
export function pendingHabitState(items: readonly QueuedItem[], userId: string, habitId: string, day: string): boolean | undefined {
  let latest: QueuedHabit | undefined;
  for (const i of items) {
    if (i.kind === "habit" && i.userId === userId && !i.error && i.input.habitId === habitId && i.input.day === day) {
      if (!latest || i.queuedAt >= latest.queuedAt) latest = i;
    }
  }
  return latest?.input.done;
}

/** Drop the refused writes the person has seen. */
export async function dismissRefused(store: OutboxStore, userId: string): Promise<void> {
  const items = await loadItems(store);
  await store.save(items.filter((i) => !(i.userId === userId && i.error)));
}
