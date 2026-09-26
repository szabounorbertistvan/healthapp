import { describe, expect, it } from "vitest";
import { relevantOneRm } from "@healthapp/shared";
import { toPrRows, type BestSetRow } from "./prs-map";

function row(over: Partial<BestSetRow>): BestSetRow {
  return {
    exercise_id: "ex-1",
    weight_kg: 100,
    reps: 5,
    completed_at: "2026-09-12T10:00:00Z",
    name_en: "Deadlift",
    name_ro: null,
    ...over,
  };
}

describe("toPrRows", () => {
  it("computes the value with relevantOneRm — the exercise page's number, unrounded", () => {
    const [pr] = toPrRows([row({ weight_kg: 72.5, reps: 5 })]);
    expect(pr!.best).toBe(relevantOneRm(72.5, 5));
    expect(pr!.best).toBeCloseTo(84.583, 3);
  });

  it("takes a single rep at face value", () => {
    expect(toPrRows([row({ weight_kg: 140, reps: 1 })])[0]!.best).toBe(140);
  });

  it("accepts numeric columns that arrive as strings", () => {
    const [pr] = toPrRows([row({ weight_kg: "72.50" as unknown as number, reps: 5 })]);
    expect(pr!.best).toBe(relevantOneRm(72.5, 5));
  });

  it("dates the record by the session that reached it", () => {
    expect(toPrRows([row({})])[0]!.at).toBe("2026-09-12T10:00:00Z");
  });

  it("keeps the name rule the list always had: Romanian when there is one", () => {
    expect(toPrRows([row({ name_ro: "Îndreptări" })])[0]!.exercise).toBe("Îndreptări");
    expect(toPrRows([row({ name_en: null })])[0]!.exercise).toBe("—");
  });

  it("drops a row with no estimate rather than showing a zero", () => {
    expect(toPrRows([row({ weight_kg: 0 }), row({ exercise_id: "ex-2", reps: 20 })])).toEqual([]);
  });

  it("sorts heaviest first, name as the tie-break", () => {
    const list = toPrRows([
      row({ exercise_id: "a", name_en: "B", weight_kg: 50, reps: 1 }),
      row({ exercise_id: "b", name_en: "A", weight_kg: 50, reps: 1 }),
      row({ exercise_id: "c", name_en: "C", weight_kg: 90, reps: 1 }),
    ]);
    expect(list.map((p) => p.exercise)).toEqual(["C", "A", "B"]);
  });
});

/**
 * exercise_best_sets() ranks sets with an exact integer-scaled key instead of
 * computing the estimate. That key must order sets exactly as relevantOneRm()
 * does, or the SQL picks one set and the page would have preferred another.
 * This is the SQL expression, transcribed; if either side changes, this fails.
 */
describe("exercise_best_sets() ranking key", () => {
  const sqlKey = (w: number, reps: number) => (reps === 1 ? w * 30 : w * (30 + reps));

  it("is relevantOneRm × 30 for every rep count the function admits", () => {
    for (const w of [20, 21.25, 72.5, 100, 142.5]) {
      for (let reps = 1; reps <= 12; reps++) {
        expect(sqlKey(w, reps)).toBeCloseTo(relevantOneRm(w, reps)! * 30, 9);
      }
    }
  });

  it("orders a single against a double the way relevantOneRm does", () => {
    // 100×1 is 100 at face value; 96×2 is 102.4.
    expect(sqlKey(96, 2) > sqlKey(100, 1)).toBe(relevantOneRm(96, 2)! > relevantOneRm(100, 1)!);
  });
});
