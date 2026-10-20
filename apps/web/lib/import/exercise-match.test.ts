import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildMatchIndex, matchExercise, nameTokens, type LibraryExercise } from "./exercise-match";

// The seeded library itself (supabase/seed/exercises.json), with the name as id,
// so every expectation below is checked against the rows people really pick from.
const seed = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../supabase/seed/exercises.json"), "utf8"),
) as { name_en: string; name_ro: string | null; equipment: string | null }[];
const library: LibraryExercise[] = seed.map((e) => ({ id: e.name_en, name_en: e.name_en, name_ro: e.name_ro, equipment: e.equipment, mine: false }));
const index = buildMatchIndex(library);
const match = (name: string) => matchExercise(name, index).exerciseId;

describe("nameTokens", () => {
  it("folds spellings, plurals, brackets and accents", () => {
    expect([...nameTokens("Pull-Ups (Bodyweight)")].sort()).toEqual(["bodyweight", "pullup"]);
    expect([...nameTokens("Crunches", "body only")].sort()).toEqual(["bodyweight", "crunch"]);
    expect([...nameTokens("Flexii cu gantere (DB)")].sort()).toEqual(["cu", "dumbbell", "flexii", "gantere"]);
    expect(nameTokens("Bench Press").has("press")).toBe(true);
  });
});

describe("matchExercise", () => {
  it("matches the most common Hevy / Strong names to the library", () => {
    expect(match("Bench Press (Barbell)")).toBe("Barbell Bench Press - Medium Grip");
    expect(match("Squat (Barbell)")).toBe("Barbell Squat");
    expect(match("Deadlift (Barbell)")).toBe("Barbell Deadlift");
    expect(match("Overhead Press (Barbell)")).toBe("Standing Military Press");
    expect(match("Lat Pulldown (Cable)")).toBe("Wide-Grip Lat Pulldown");
    expect(match("Pull Up")).toBe("Pullups");
    expect(match("Hammer Curl (Dumbbell)")).toBe("Hammer Curls");
    expect(match("Leg Extension (Machine)")).toBe("Leg Extensions");
    expect(match("Plank")).toBe("Plank");
    expect(match("Face Pull (Cable)")).toBe("Face Pull");
  });

  it("matches a name already written the library's way", () => {
    expect(match("Barbell Hip Thrust")).toBe("Barbell Hip Thrust");
    expect(match("seated cable rows")).toBe("Seated Cable Rows");
  });

  it("leaves a name it is not sure about to the review step, with suggestions", () => {
    const m = matchExercise("Bulgarian Split Squat (Dumbbell)", index);
    expect(m.exerciseId).toBeNull();
    expect(m.suggestions.length).toBeGreaterThan(0);
    expect(matchExercise("Zercher Yoke Walk", index).exerciseId).toBeNull();
  });

  it("prefers the person's own exercise with the same name", () => {
    const own = buildMatchIndex([...library, { id: "mine", name_en: "Barbell Squat", name_ro: null, equipment: null, mine: true }]);
    expect(matchExercise("Barbell Squat", own).exerciseId).toBe("mine");
  });

  it("every alias points at a row that exists", () => {
    // matchExercise falls through to fuzzy matching when an alias target is
    // missing; read the module's own list through a name each alias covers.
    const names = new Set(library.map((e) => e.name_en.toLowerCase()));
    const source = readFileSync(path.resolve(__dirname, "exercise-match.ts"), "utf8");
    const targets = [...source.matchAll(/\["[^"]+", "([^"]+)"\]/g)].map((m) => m[1]!.toLowerCase());
    expect(targets.length).toBeGreaterThan(50);
    expect(targets.filter((t) => !names.has(t))).toEqual([]);
  });
});
