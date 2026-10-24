import Storage from "./kv";

// The phone's own copy of what the workout screens need offline: the outbox,
// the rest timer, and the last answer of each training read. SQLite-backed
// key-value storage — app-private, never synced anywhere, and wiped on sign-out
// (wipeUserData) except for sets still waiting to be sent.
//
// Keys are per person, so a phone that changes hands never shows one person's
// cached day to another.

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await Storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await Storage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or failing disk costs the offline copy, never the action itself.
  }
}

export async function removeKey(key: string): Promise<void> {
  await Storage.removeItem(key).catch(() => {});
}

export const OUTBOX_KEY = "outbox:sets:v1";
export const REST_KEY = "rest:timer:v1";
export const cacheKey = (userId: string, name: string) => `cache:${userId}:${name}`;

/** On sign-out: the cached reads and the timer go; the outbox stays (it belongs to its owner, by id). */
export async function wipeUserData(): Promise<void> {
  try {
    const keys = await Storage.getAllKeys();
    for (const key of keys) if (key.startsWith("cache:") || key === REST_KEY) await Storage.removeItem(key);
  } catch {
    // nothing cached
  }
}
