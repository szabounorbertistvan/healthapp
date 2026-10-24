// Browser preview only (npx expo start --web): expo-secure-store has no web
// implementation, so the session lives in localStorage there. Never shipped
// to a phone — native builds use secure-store.ts.
export async function getItemAsync(key: string): Promise<string | null> {
  return globalThis.localStorage?.getItem(key) ?? null;
}
export async function setItemAsync(key: string, value: string): Promise<void> {
  globalThis.localStorage?.setItem(key, value);
}
export async function deleteItemAsync(key: string): Promise<void> {
  globalThis.localStorage?.removeItem(key);
}
