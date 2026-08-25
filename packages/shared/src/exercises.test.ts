import { describe, expect, test } from "vitest";
import { filterExercises, type ExerciseSummary } from "./exercises";

// W5 exercise library. The coach filters while building a program; the client
// browses the same library from the mobile app, so the matching rules live here
// rather than in either screen.

const library: ExerciseSummary[] = [
  ex({ external_id: "squat", name_en: "Barbell Squat", equipment: "barbell", primary_muscles: ["quadriceps"], secondary_muscles: ["glutes", "hamstrings"] }),
  ex({ external_id: "curl", name_en: "Barbell Curl", equipment: "barbell", primary_muscles: ["biceps"] }),
  ex({ external_id: "chin", name_en: "Chin-Up", equipment: "body only", primary_muscles: ["lats"], secondary_muscles: ["biceps"] }),
  ex({ external_id: "press", name_en: "Bench Press", name_ro: "Împins la piept", equipment: "barbell", primary_muscles: ["chest"], secondary_muscles: ["triceps"] }),
];

describe("filterExercises", () => {
  test("returns the whole library when nothing is filtered", () => {
    expect(filterExercises(library, {})).toHaveLength(4);
  });

  test("matches part of the name, ignoring case", () => {
    const found = filterExercises(library, { q: "barbell" });
    expect(found.map((e) => e.external_id).sort()).toEqual(["curl", "squat"]);
  });

  test("matches the Romanian name too", () => {
    expect(filterExercises(library, { q: "împins" }).map((e) => e.external_id)).toEqual(["press"]);
  });

  test("finds an exercise by a muscle it works indirectly", () => {
    expect(filterExercises(library, { muscle: "biceps" }).map((e) => e.external_id)).toEqual([
      "curl",
      "chin",
    ]);
  });

  test("filters by equipment", () => {
    expect(filterExercises(library, { equipment: "body only" }).map((e) => e.external_id)).toEqual([
      "chin",
    ]);
  });

  test("combines filters", () => {
    expect(
      filterExercises(library, { q: "barbell", muscle: "quadriceps" }).map((e) => e.external_id),
    ).toEqual(["squat"]);
  });

  test("returns nothing when a filter matches nothing", () => {
    expect(filterExercises(library, { muscle: "neck" })).toEqual([]);
  });
});

function ex(over: Partial<ExerciseSummary>): ExerciseSummary {
  return {
    external_id: "x",
    name_en: "Exercise",
    name_ro: null,
    category: "strength",
    level: "beginner",
    force: null,
    mechanic: null,
    equipment: null,
    primary_muscles: [],
    secondary_muscles: [],
    instructions_en: "",
    images: [],
    ...over,
  };
}
