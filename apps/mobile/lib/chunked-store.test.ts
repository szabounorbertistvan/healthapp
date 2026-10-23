import { describe, expect, it } from "vitest";
import { chunkedStore, type KeyValue } from "./chunked-store";

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

describe("chunkedStore", () => {
  it("round-trips a value longer than one chunk", async () => {
    const base = memory();
    const store = chunkedStore(base, 10);
    const session = JSON.stringify({ access_token: "a".repeat(45), user: { email: "ă@ș.ro" } });
    await store.setItem("sb", session);
    expect(base.data.get("sb")).toBe(String(Math.ceil(session.length / 10)));
    expect(await store.getItem("sb")).toBe(session);
  });

  it("leaves no stale chunks when a shorter value replaces a longer one", async () => {
    const base = memory();
    const store = chunkedStore(base, 4);
    await store.setItem("sb", "0123456789");
    await store.setItem("sb", "ab");
    expect(await store.getItem("sb")).toBe("ab");
    expect([...base.data.keys()].sort()).toEqual(["sb", "sb.0"]);
  });

  it("reads nothing when a chunk is missing, and removes every key", async () => {
    const base = memory();
    const store = chunkedStore(base, 4);
    await store.setItem("sb", "0123456789");
    base.data.delete("sb.1");
    expect(await store.getItem("sb")).toBeNull();
    await store.removeItem("sb");
    expect(base.data.size).toBe(0);
  });

  it("is empty for a key never written", async () => {
    expect(await chunkedStore(memory()).getItem("none")).toBeNull();
  });
});
