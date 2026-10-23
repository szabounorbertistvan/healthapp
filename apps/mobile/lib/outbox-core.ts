import type { LogSetV1 } from "@healthapp/api/v1";

// The phone's outbox for logged sets — the native counterpart of the web's
// lib/offline/outbox.ts, with one difference: here *every* set goes through it.
// "Log set" writes to the phone first (so it shows at once, signal or not), then
// the outbox sends it to POST /api/v1/sets, i.e. through the web's own logSet().
// That is safe to repeat: logSet derives the session and set keys from the set
// itself and answers ok for a set already on record, so a set whose answer was
// lost with the signal is simply sent again.
//
// Pure: storage and sending are passed in, so the rules are tested in node
// (outbox-core.test.ts) and lib/outbox.tsx only wires the real ones.

export type QueuedSet = {
  /** Local id; the server's key is derived from the set itself. */
  id: string;
  /** Who logged it: replayed only while that same person is signed in. */
  userId: string;
  input: LogSetV1;
  queuedAt: string;
  /** The server answered and refused it: kept for the person to see, never retried. */
  error?: string | null;
};

export type OutboxStore = {
  load(): Promise<QueuedSet[]>;
  save(items: QueuedSet[]): Promise<void>;
};

/** What one send came back with. Only "ok" and "refused" are answers; the rest mean "later". */
export type SendOutcome =
  | { kind: "ok"; isPr: boolean }
  | { kind: "refused"; message: string }
  | { kind: "offline" }
  | { kind: "unauthorized" };

export type FlushResult = {
  synced: { item: QueuedSet; isPr: boolean }[];
  refused: QueuedSet[];
  /** Why the flush stopped early, if it did. */
  stoppedBy: "offline" | "unauthorized" | null;
};

export async function enqueue(store: OutboxStore, item: QueuedSet): Promise<void> {
  const items = await store.load();
  if (items.some((i) => i.id === item.id)) return;
  await store.save([...items, item]);
}

/**
 * Send the signed-in person's waiting sets, oldest first, one at a time (a set
 * opens its session; order keeps set numbers and session start right). Stops
 * at the first "later" outcome — no signal now means no signal for the next
 * set either — and leaves everything not answered exactly where it was.
 */
export async function flushOutbox(
  store: OutboxStore,
  userId: string,
  send: (input: LogSetV1) => Promise<SendOutcome>,
): Promise<FlushResult> {
  const result: FlushResult = { synced: [], refused: [], stoppedBy: null };
  const pending = (await store.load())
    .filter((i) => i.userId === userId && !i.error)
    .sort((a, b) => a.input.loggedAt.localeCompare(b.input.loggedAt) || a.queuedAt.localeCompare(b.queuedAt));

  for (const item of pending) {
    const outcome = await send(item.input);
    if (outcome.kind === "offline" || outcome.kind === "unauthorized") {
      result.stoppedBy = outcome.kind;
      break;
    }
    // Re-read before each write: a set logged while this flush runs must survive it.
    const now = await store.load();
    if (outcome.kind === "ok") {
      await store.save(now.filter((i) => i.id !== item.id));
      result.synced.push({ item, isPr: outcome.isPr });
    } else {
      const refused = { ...item, error: outcome.message || "refused" };
      await store.save(now.map((i) => (i.id === item.id ? refused : i)));
      result.refused.push(refused);
    }
  }
  return result;
}

/** The person's sets still waiting (or refused) for one training day. */
export function queuedForDay(items: readonly QueuedSet[], userId: string, dayId: string): QueuedSet[] {
  return items.filter((i) => i.userId === userId && i.input.dayId === dayId);
}

/** Drop the refused sets the person has seen. */
export async function dismissRefused(store: OutboxStore, userId: string): Promise<void> {
  const items = await store.load();
  await store.save(items.filter((i) => !(i.userId === userId && i.error)));
}
