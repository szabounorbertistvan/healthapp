// The Supabase session belongs in the Android Keystore-backed SecureStore, but
// SecureStore warns above 2 KB per value and a session (two JWTs plus the user
// object) is often larger. So a value is split across numbered keys, with the
// count stored under the key itself. Pure logic here; lib/supabase.ts plugs in
// the real SecureStore.

export type KeyValue = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

/** Below SecureStore's 2048-byte warning even for multi-byte characters' worst case. */
export const CHUNK_CHARS = 600;

const chunkKey = (key: string, i: number) => `${key}.${i}`;

export function chunkedStore(base: KeyValue, size = CHUNK_CHARS) {
  async function removeItem(key: string) {
    const count = Number(await base.get(key));
    if (Number.isInteger(count) && count > 0) {
      for (let i = 0; i < count; i++) await base.remove(chunkKey(key, i));
    }
    await base.remove(key);
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const count = Number(await base.get(key));
      if (!Number.isInteger(count) || count <= 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await base.get(chunkKey(key, i));
        // A half-written value is no value: better signed out than a corrupt session.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join("");
    },
    async setItem(key: string, value: string): Promise<void> {
      await removeItem(key);
      const count = Math.max(1, Math.ceil(value.length / size));
      for (let i = 0; i < count; i++) await base.set(chunkKey(key, i), value.slice(i * size, (i + 1) * size));
      // The count last: until it is written, a reader sees no value rather than a partial one.
      await base.set(key, String(count));
    },
    removeItem,
  };
}
