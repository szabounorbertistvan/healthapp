// The offline outbox for logged sets: an IndexedDB store on this device.
//
// A set that cannot reach the server — no signal at the gym, a request that
// died in flight — is written here and replayed later through the very same
// logSet() server action, by lib/offline/sync.tsx. That is safe because logSet
// is idempotent: the session and the set carry deterministic
// client_generated_ids, and a replay of a set already on record answers ok.
// (sync-ingest, the edge function, is the outbox endpoint for a native app;
// the web needs none.)
//
// Every item carries the user it was logged by and is replayed only while that
// same user is signed in, so a phone that changes hands never files one
// person's sets under another's account.
import type { LogSetInput } from "@/app/client-actions-training";

export type QueuedSet = {
  /** Local id; the server's own key is derived from the set itself. */
  id: string;
  userId: string;
  dayId: string;
  input: LogSetInput & { loggedAt: string };
  queuedAt: string;
  /** Set once the server answered and refused it; such an item is not retried. */
  error?: string | null;
};

/**
 * The other writes that can wait for a connection (2026-12-07): a food log,
 * a habit tick, a weekly check-in. Each is replayed through its own server
 * action, made safe to deliver twice: logFood takes the browser's clientId,
 * setHabitDone sets a state instead of toggling, and a check-in already on
 * record answers ALREADY_CHECKED_IN, which the replay counts as done.
 */
export type QueuedActionPayload =
  | { kind: "food"; input: { slot: "breakfast" | "lunch" | "dinner" | "snack"; foodName: string; grams: number;
      per100g: { kcal: number; protein: number; carbs: number; fat: number }; foodId: string | null; day: string; clientId: string } }
  | { kind: "habit"; habitId: string; day: string; done: boolean }
  | { kind: "checkin"; input: { weightKg: number | null; sleep: number; energy: number; stress: number; hunger: number; recovery: number; note: string } };

export type QueuedAction = QueuedActionPayload & {
  id: string;
  userId: string;
  queuedAt: string;
  error?: string | null;
};

const DB = "voinic-outbox";
const STORE = "sets";
const ACTIONS = "actions";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // version 2 adds the actions store; the sets store and its rows are kept
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" }).createIndex("userId", "userId");
      }
      if (!db.objectStoreNames.contains(ACTIONS)) {
        db.createObjectStore(ACTIONS, { keyPath: "id" }).createIndex("userId", "userId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = work(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Whether this browser can hold an outbox at all (not in some private modes). */
export function outboxAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export async function putQueued(item: QueuedSet): Promise<boolean> {
  try {
    await run("readwrite", (store) => store.put(item));
    return true;
  } catch {
    return false;
  }
}

export async function removeQueued(id: string): Promise<void> {
  try {
    await run("readwrite", (store) => store.delete(id));
  } catch {
    // a leftover is replayed again and answers ok as a duplicate
  }
}

/** This user's items, oldest first — the order the sets were done in. */
export async function listQueued(userId: string): Promise<QueuedSet[]> {
  if (!outboxAvailable()) return [];
  try {
    const items = await run<QueuedSet[]>("readonly", (store) => store.index("userId").getAll(userId));
    return items.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  } catch {
    return [];
  }
}

export async function putAction(item: QueuedAction): Promise<boolean> {
  try {
    await run("readwrite", (store) => store.put(item), ACTIONS);
    return true;
  } catch {
    return false;
  }
}

export async function removeAction(id: string): Promise<void> {
  try {
    await run("readwrite", (store) => store.delete(id), ACTIONS);
  } catch {
    // a leftover is replayed again and answers ok as a duplicate
  }
}

/** This user's waiting actions, oldest first. */
export async function listActions(userId: string): Promise<QueuedAction[]> {
  if (!outboxAvailable()) return [];
  try {
    const items = await run<QueuedAction[]>("readonly", (store) => store.index("userId").getAll(userId), ACTIONS);
    return items.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  } catch {
    return [];
  }
}
