import type { LogSetV1 } from "@healthapp/api/v1";
import { describe, expect, it } from "vitest";
import { dismissRefused, enqueue, flushOutbox, pendingHabitState, queuedFoodFor, queuedForDay, type OutboxStore, type QueuedItem, type QueuedSet, type SendOutcome } from "./outbox-core";

function memoryStore(initial: QueuedItem[] = []): OutboxStore & { items: QueuedItem[] } {
  const store = {
    items: [...initial],
    load: async () => [...store.items],
    save: async (items: QueuedItem[]) => void (store.items = [...items]),
  };
  return store;
}

const input = (setIndex: number, at: string, dayId = "day-1"): LogSetV1 => ({
  dayId, dayName: "Day 1", exerciseName: "Squat", exerciseId: "ex-1", programExerciseId: "pe-1",
  setIndex, weightKg: 60, reps: 8, rpe: 8, loggedAt: at,
});
const item = (id: string, setIndex: number, at: string, userId = "me"): QueuedSet => ({
  kind: "set", id, userId, input: input(setIndex, at), queuedAt: at,
});

describe("flushOutbox", () => {
  it("sends oldest first and removes what the server took", async () => {
    const store = memoryStore([item("b", 2, "2026-10-23T10:02:00Z"), item("a", 1, "2026-10-23T10:01:00Z")]);
    const sent: number[] = [];
    const result = await flushOutbox(store, "me", async (p) => {
      const setIndex = p.kind === "set" ? p.input.setIndex : 0;
      sent.push(setIndex);
      return { kind: "ok", isPr: setIndex === 2 };
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

  it("dismisses only one kind's refusals when asked (a check-in sent again leaves a refused set alone)", async () => {
    const checkin = { kind: "checkin", id: "c", userId: "me", queuedAt: "2026-10-23T10:00:00Z", error: "Enter a weight between 20 and 400 kg.",
      input: { weightKg: 9999, sleep: 5, energy: 5, stress: 5, hunger: 5, recovery: 5, note: "", answers: [] } } as QueuedItem;
    const store = memoryStore([{ ...item("a", 1, "2026-10-23T10:01:00Z"), error: "Reps must be 1–100" }, checkin]);
    await dismissRefused(store, "me", "checkin");
    expect(store.items.map((i) => i.id)).toEqual(["a"]);
  });

  it("only ever sends the signed-in person's sets", async () => {
    const store = memoryStore([item("theirs", 1, "2026-10-23T10:01:00Z", "someone-else"), item("mine", 1, "2026-10-23T10:02:00Z")]);
    const sentIds: string[] = [];
    await flushOutbox(store, "me", async (p) => (sentIds.push(p.kind === "set" ? p.input.loggedAt : ""), { kind: "ok", isPr: false }));
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

describe("other kinds", () => {
  const habit = (id: string, done: boolean, at: string): QueuedItem => ({
    kind: "habit", id, userId: "me", queuedAt: at, input: { habitId: "h1", day: "2026-10-23", done },
  });
  const food = (id: string, at: string): QueuedItem => ({
    kind: "food", id, userId: "me", queuedAt: at,
    input: { slot: "lunch", foodName: "Rice", grams: 150, per100g: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }, foodId: null, day: "2026-10-23", clientId: id },
  });

  it("replays a habit ticked then unticked in that order, and shows the last state meanwhile", async () => {
    const store = memoryStore([habit("h-off", false, "2026-10-23T10:05:00Z"), habit("h-on", true, "2026-10-23T10:01:00Z")]);
    expect(pendingHabitState(store.items, "me", "h1", "2026-10-23")).toBe(false);
    const order: boolean[] = [];
    await flushOutbox(store, "me", async (p) => (p.kind === "habit" && order.push(p.input.done), { kind: "ok", isPr: false }));
    expect(order).toEqual([true, false]);
    expect(pendingHabitState(store.items, "me", "h1", "2026-10-23")).toBeUndefined();
  });

  it("sends a food log with its own id as the clientId, and lists it for its day only", async () => {
    const store = memoryStore([food("f1", "2026-10-23T12:00:00Z")]);
    expect(queuedFoodFor(store.items, "me", "2026-10-23")).toHaveLength(1);
    expect(queuedFoodFor(store.items, "me", "2026-10-22")).toHaveLength(0);
    const ids: string[] = [];
    await flushOutbox(store, "me", async (p, id) => (ids.push(p.kind === "food" ? p.input.clientId + ":" + id : ""), { kind: "ok", isPr: false }));
    expect(ids).toEqual(["f1:f1"]);
  });

  it("reads a record stored before kinds existed as a set", async () => {
    const legacy = { id: "old", userId: "me", queuedAt: "2026-10-23T09:00:00Z", input: input(1, "2026-10-23T09:00:00Z") };
    const store = memoryStore([legacy as unknown as QueuedItem]);
    const kinds: string[] = [];
    await flushOutbox(store, "me", async (p) => (kinds.push(p.kind), { kind: "ok", isPr: false }));
    expect(kinds).toEqual(["set"]);
  });
});
