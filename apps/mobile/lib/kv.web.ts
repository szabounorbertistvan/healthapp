// Browser preview only: expo-sqlite on the web needs special headers, so the
// preview keeps its outbox and cached reads in localStorage instead.
const kv = {
  async getItem(key: string): Promise<string | null> {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    globalThis.localStorage?.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    globalThis.localStorage?.removeItem(key);
  },
  async getAllKeys(): Promise<string[]> {
    const ls = globalThis.localStorage;
    return ls ? Array.from({ length: ls.length }, (_, i) => ls.key(i) ?? "").filter(Boolean) : [];
  },
};
export default kv;
