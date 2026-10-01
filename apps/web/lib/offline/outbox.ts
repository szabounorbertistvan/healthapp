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
import type { LogSetInput } from "@/app/client-actions-app";

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

const DB = "voinic-outbox";
const STORE = "sets";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("userId", "userId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
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
