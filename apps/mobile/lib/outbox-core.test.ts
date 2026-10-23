import type { LogSetV1 } from "@healthapp/api/v1";
import { describe, expect, it } from "vitest";
import { dismissRefused, enqueue, flushOutbox, queuedForDay, type OutboxStore, type QueuedSet, type SendOutcome } from "./outbox-core";

function memoryStore(initial: QueuedSet[] = []): OutboxStore & { items: QueuedSet[] } {
  const store = {
    items: [...initial],
    load: async () => [...store.items],
    save: async (items: QueuedSet[]) => void (store.items = [...items]),
  };
  return store;
}

const input = (setIndex: number, at: string, dayId = "day-1"): LogSetV1 => ({
  dayId, dayName: "Day 1", exerciseName: "Squat", exerciseId: "ex-1", programExerciseId: "pe-1",
  setIndex, weightKg: 60, reps: 8, rpe: 8, loggedAt: at,
});
const item = (id: string, setIndex: number, at: string, userId = "me"): QueuedSet => ({
  id, userId, input: input(setIndex, at), queuedAt: at,
});

describe("flushOutbox", () => {
  it("sends oldest first and removes what the server took", async () => {
    const store = memoryStore([item("b", 2, "2026-10-23T10:02:00Z"), item("a", 1, "2026-10-23T10:01:00Z")]);
    const sent: number[] = [];
    const result = await flushOutbox(store, "me", async (i) => {
      sent.push(i.setIndex);
      return { kind: "ok", isPr: i.setIndex === 2 };
    });
    expect(sent).toEqual([1, 2]);
    expect(store.items).toEqual([]);
    expect(result.synced.map((s) => [s.item.id, s.isPr])).toEqual([["a", false], ["b", true]]);
  });

  it("stops at the first 'no signal' and keeps the rest untouched", async () => {
    const store = memoryStore([item("a", 1, "2026-10-23T10:01:00Z"), item("b", 2, "2026-10-23T10:02:00Z")]);
    const outcomes: SendOutcome[] = [{ kind: "ok", isPr: false }, { kind: "offline" }];
    const result = await flushOutbox(store, "me", async () => outcomes.shift()!);
    expect(result.stoppedBy).toBe("offline");
    expect(store.items.map((i) => i.id)).toEqual(["b"]);
    expect(store.items[0]!.error).toBeUndefined();
  });

  it("keeps a refused set with its reason and never sends it again", async () => {
    const store = memoryStore([item("a", 1, "2026-10-23T10:01:00Z")]);
    await flushOutbox(store, "me", async () => ({ kind: "refused", message: "Reps must be 1–100" }));
    expect(store.items[0]!.error).toBe("Reps must be 1–100");
    let calls = 0;
    await flushOutbox(store, "me", async () => (calls++, { kind: "ok", isPr: false }));
    expect(calls).toBe(0);
    await dismissRefused(store, "me");
    expect(store.items).toEqual([]);
  });

  it("only ever sends the signed-in person's sets", async () => {
    const store = memoryStore([item("theirs", 1, "2026-10-23T10:01:00Z", "someone-else"), item("mine", 1, "2026-10-23T10:02:00Z")]);
    const sentIds: string[] = [];
    await flushOutbox(store, "me", async (i) => (sentIds.push(i.loggedAt), { kind: "ok", isPr: false }));
    expect(sentIds).toEqual(["2026-10-23T10:02:00Z"]);
    expect(store.items.map((i) => i.id)).toEqual(["theirs"]);
  });

  it("does not lose a set logged while a flush is running", async () => {
    const store = memoryStore([item("a", 1, "2026-10-23T10:01:00Z")]);
    await flushOutbox(store, "me", async () => {
      await enqueue(store, item("late", 2, "2026-10-23T10:02:00Z"));
      return { kind: "ok", isPr: false };
    });
    expect(store.items.map((i) => i.id)).toEqual(["late"]);
  });

  it("enqueue is idempotent per local id", async () => {
    const store = memoryStore();
    const a = item("a", 1, "2026-10-23T10:01:00Z");
    await enqueue(store, a);
    await enqueue(store, a);
    expect(store.items).toHaveLength(1);
    expect(queuedForDay(store.items, "me", "day-1")).toHaveLength(1);
    expect(queuedForDay(store.items, "me", "day-2")).toHaveLength(0);
  });
});
