import { describe, expect, it } from "vitest";
import {
  canChangeVisibility,
  canCopyProgram,
  canEditRoutine,
  canSeeProgram,
  copyName,
  estimateMinutes,
  isFilterActive,
  normalizeRoutineFilter,
  routineSource,
  sessionMinutes,
  canFeatureProgram,
  snapshotProgram,
  canShareProgram,
  SET_WORK_SECONDS,
  type RoutineCard,
} from "./routines";
import { DEFAULT_TARGETS } from "./program-editing";

const SOLO = "u-solo";
const COACH = "u-coach";
const CLIENT = "u-client";
const STRANGER = "u-stranger";

function card(over: Partial<RoutineCard> = {}): RoutineCard {
  return {
    id: "p1",
    name: "Public PPL",
    description: "Six days.",
    level: "intermediate",
    goal: "hypertrophy",
    visibility: "public",
    status: "published",
    coach_id: null,
    client_id: SOLO,
    source_program_id: null,
    author_id: SOLO,
    author_name: "Solo",
    author_username: "solo",
    author_avatar: null,
    weeks: 4,
    days_per_week: 3,
    session_minutes: 45,
    training_style: null,
    featured: false,
    source: "user",
    days: 6,
    exercises: 24,
    total_sets: 72,
    est_minutes: 62,
    muscle_groups: ["chest", "middle back"],
    equipment: ["barbell"],
    copy_count: 3,
    saved: false,
    is_mine: false,
    assigned_by_coach: false,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-20T10:00:00Z",
    ...over,
  };
}

describe("estimateMinutes", () => {
  it("charges each set its work time plus its own prescribed rest", () => {
    // 3 sets × (40 s work + 90 s rest) = 390 s = 6 min
    expect(estimateMinutes([{ target_sets: 3, rest_seconds: 90 }])).toBe(6);
  });

  it("falls back to the builder's own default rest, not a second opinion", () => {
    expect(estimateMinutes([{ target_sets: 3, rest_seconds: null }])).toBe(
      estimateMinutes([{ target_sets: 3, rest_seconds: DEFAULT_TARGETS.rest_seconds }]),
    );
  });

  it("sums a whole day", () => {
    const day = [
      { target_sets: 3, rest_seconds: 90 },
      { target_sets: 4, rest_seconds: 60 },
      { target_sets: 3, rest_seconds: 60 },
    ];
    // 3×130 + 4×100 + 3×100 = 390 + 400 + 300 = 1090 s → 18 min
    expect(estimateMinutes(day)).toBe(18);
  });

  it("is zero for an empty day rather than NaN", () => {
    expect(estimateMinutes([])).toBe(0);
  });

  it("ignores a negative set count instead of subtracting time", () => {
    expect(estimateMinutes([{ target_sets: -5, rest_seconds: 60 }])).toBe(0);
  });

  it("matches the SQL in program_card_rows: sets × (40 + coalesce(rest, 90))", () => {
    const exercises = [
      { target_sets: 5, rest_seconds: 120 },
      { target_sets: 2, rest_seconds: null },
    ];
    const sql = 5 * (SET_WORK_SECONDS + 120) + 2 * (SET_WORK_SECONDS + 90);
    expect(estimateMinutes(exercises)).toBe(Math.floor(sql / 60));
  });
});

describe("copyName", () => {
  it("suggests a name that says what it is", () => {
    expect(copyName("PPL 2026")).toBe("PPL 2026 (copy)");
  });

  it("numbers the next one rather than colliding", () => {
    expect(copyName("PPL", ["PPL", "PPL (copy)"])).toBe("PPL (copy 2)");
    expect(copyName("PPL", ["PPL (copy)", "PPL (copy 2)"])).toBe("PPL (copy 3)");
  });

  it("ignores case and padding when deciding what is taken", () => {
    expect(copyName("PPL", ["  ppl (COPY)  "])).toBe("PPL (copy 2)");
  });

  it("never returns an empty name", () => {
    expect(copyName("   ")).toBe("Routine (copy)");
  });

  it("stays inside the column's 120 characters", () => {
    expect(copyName("x".repeat(200)).length).toBeLessThanOrEqual(120);
  });
});

describe("canSeeProgram", () => {
  const viewer = { id: STRANGER, has_active_coach: false };

  it("lets anyone read a public routine", () => {
    expect(canSeeProgram(card(), viewer)).toBe(true);
  });

  it("hides a private routine from everyone else", () => {
    expect(canSeeProgram(card({ visibility: "private" }), viewer)).toBe(false);
  });

  it("shows a followers-only routine to a follower and nobody else", () => {
    const followers = card({ visibility: "followers" });
    expect(canSeeProgram(followers, { ...viewer, follows_author: true })).toBe(true);
    expect(canSeeProgram(followers, { ...viewer, follows_author: false })).toBe(false);
    expect(canSeeProgram(followers, viewer)).toBe(false);
  });

  it("always shows a routine to the person it belongs to and to its coach", () => {
    const coached = card({ visibility: "private", coach_id: COACH, client_id: CLIENT });
    expect(canSeeProgram(coached, { id: CLIENT, has_active_coach: true })).toBe(true);
    expect(canSeeProgram(coached, { id: COACH, has_active_coach: false })).toBe(true);
    expect(canSeeProgram(coached, viewer)).toBe(false);
  });
});

describe("canCopyProgram", () => {
  it("lets an uncoached person copy what they can see", () => {
    expect(canCopyProgram(card(), { id: STRANGER, has_active_coach: false })).toBe(true);
  });

  it("refuses a coached client — their coach authors their programs", () => {
    expect(canCopyProgram(card(), { id: CLIENT, has_active_coach: true })).toBe(false);
  });

  it("refuses what cannot be seen in the first place", () => {
    expect(canCopyProgram(card({ visibility: "private" }), { id: STRANGER, has_active_coach: false })).toBe(false);
  });
});

describe("canEditRoutine", () => {
  it("lets a coach edit the programs they wrote", () => {
    const coached = card({ coach_id: COACH, client_id: CLIENT });
    expect(canEditRoutine(coached, { id: COACH, has_active_coach: false })).toBe(true);
  });

  it("does not let the client edit what their coach assigned", () => {
    const coached = card({ coach_id: COACH, client_id: CLIENT });
    expect(canEditRoutine(coached, { id: CLIENT, has_active_coach: true })).toBe(false);
  });

  it("lets a solo owner edit their own", () => {
    expect(canEditRoutine(card(), { id: SOLO, has_active_coach: false })).toBe(true);
  });

  it("freezes a solo program the moment a coach becomes active", () => {
    expect(canEditRoutine(card(), { id: SOLO, has_active_coach: true })).toBe(false);
  });
});

describe("canChangeVisibility", () => {
  it("is the owner's call on their own routine", () => {
    expect(canChangeVisibility(card(), { id: SOLO, has_active_coach: false })).toBe(true);
  });

  it("is never available on a coach's program — it is somebody's prescription", () => {
    const coached = card({ coach_id: COACH, client_id: CLIENT });
    expect(canChangeVisibility(coached, { id: COACH, has_active_coach: false })).toBe(false);
    expect(canChangeVisibility(coached, { id: CLIENT, has_active_coach: true })).toBe(false);
  });
});

describe("snapshotProgram", () => {
  it("carries the plan and nothing about anybody's training", () => {
    const snapshot = snapshotProgram(card());
    expect(snapshot).toEqual({
      kind: "program",
      program_id: "p1",
      name: "Public PPL",
      description: "Six days.",
      days: 6,
      exercises: 24,
      level: "intermediate",
      goal: "hypertrophy",
      muscle_groups: ["chest", "middle back"],
      est_minutes: 62,
    });
    // The shape is the guarantee. Nothing here can leak a logged weight, a
    // body weight, a measurement or a calorie into the feed.
    expect(Object.keys(snapshot).sort()).toEqual([
      "days", "description", "est_minutes", "exercises", "goal", "kind",
      "level", "muscle_groups", "name", "program_id",
    ]);
  });

  it("is a copy, so editing the routine afterwards cannot reach the post", () => {
    const original = card();
    const snapshot = snapshotProgram(original);
    original.muscle_groups.push("quadriceps");
    original.name = "Renamed";
    expect(snapshot.muscle_groups).toEqual(["chest", "middle back"]);
    expect(snapshot.name).toBe("Public PPL");
  });
});

describe("canShareProgram", () => {
  it("allows a public routine of your own that has days in it", () => {
    expect(canShareProgram({ visibility: "public", is_mine: true, days: 6 })).toBe(true);
  });

  it("refuses a private one — the post would lead nowhere for its readers", () => {
    expect(canShareProgram({ visibility: "private", is_mine: true, days: 6 })).toBe(false);
    expect(canShareProgram({ visibility: "followers", is_mine: true, days: 6 })).toBe(false);
  });

  it("refuses somebody else's routine", () => {
    expect(canShareProgram({ visibility: "public", is_mine: false, days: 6 })).toBe(false);
  });

  it("refuses an empty one", () => {
    expect(canShareProgram({ visibility: "public", is_mine: true, days: 0 })).toBe(false);
  });
});

describe("normalizeRoutineFilter", () => {
  it("keeps what it recognises", () => {
    expect(normalizeRoutineFilter({
      q: "  push  ", level: "advanced", goal: "strength", muscle: "chest",
      equipment: "barbell", sort: "most_copied",
    })).toEqual({
      q: "push", level: "advanced", goal: "strength", muscle: "chest",
      equipment: "barbell", sort: "most_copied", style: null, maxMinutes: null, featured: false,
    });
  });

  it("drops anything it does not — a hand-typed URL cannot smuggle a value in", () => {
    expect(normalizeRoutineFilter({ level: "godlike", goal: "vibes", sort: "trending" })).toEqual({
      q: undefined, level: null, goal: null, muscle: null, equipment: null, sort: "newest",
      style: null, maxMinutes: null, featured: false,
    });
  });

  it("caps a long search rather than sending it on", () => {
    expect(normalizeRoutineFilter({ q: "x".repeat(200) }).q).toHaveLength(80);
  });

  it("knows when the shelf is being narrowed", () => {
    expect(isFilterActive(normalizeRoutineFilter({}))).toBe(false);
    expect(isFilterActive(normalizeRoutineFilter({ muscle: "chest" }))).toBe(true);
    expect(isFilterActive(normalizeRoutineFilter({ sort: "most_copied" }))).toBe(false);
  });
});

describe("normalizeRoutineFilter — premium library filters", () => {
  it("reads a known training style, a supported session length and the featured switch", () => {
    expect(normalizeRoutineFilter({ style: "push_pull_legs", max: "45", featured: "1" })).toMatchObject({
      style: "push_pull_legs", maxMinutes: 45, featured: true,
    });
  });

  it("drops an unknown style, an unsupported length and any other featured value", () => {
    expect(normalizeRoutineFilter({ style: "bro", max: "37", featured: "yes" })).toMatchObject({
      style: null, maxMinutes: null, featured: false,
    });
  });

  it("counts the new filters as active", () => {
    expect(isFilterActive(normalizeRoutineFilter({ style: "full_body" }))).toBe(true);
    expect(isFilterActive(normalizeRoutineFilter({ max: "60" }))).toBe(true);
    expect(isFilterActive(normalizeRoutineFilter({ featured: "1" }))).toBe(true);
  });
});

describe("routineSource", () => {
  it("an admin-marked program is Voinic's, whoever holds the row", () => {
    expect(routineSource({ official: true, coach_id: null, author_is_coach: true })).toBe("voinic");
  });

  it("a coach's program — for a client, or a template from their own account — is a coach's", () => {
    expect(routineSource({ official: false, coach_id: "c1", author_is_coach: true })).toBe("coach");
    expect(routineSource({ official: false, coach_id: null, author_is_coach: true })).toBe("coach");
  });

  it("anything else was made by a user", () => {
    expect(routineSource({ official: false, coach_id: null, author_is_coach: false })).toBe("user");
  });
});

describe("canFeatureProgram", () => {
  it("only a public program may be featured — a shelf must not point at what readers cannot open", () => {
    expect(canFeatureProgram({ visibility: "public" })).toBe(true);
    expect(canFeatureProgram({ visibility: "followers" })).toBe(false);
    expect(canFeatureProgram({ visibility: "private" })).toBe(false);
  });
});

describe("sessionMinutes", () => {
  it("averages each day's whole minutes and rounds — the SQL session_minutes figure", () => {
    // day 1: 3·(40+60)=300 s → 5 min; day 2: 4·(40+90)=520 s → 8 min (floor); mean 6.5 → 7
    expect(sessionMinutes([
      [{ target_sets: 3, rest_seconds: 60 }],
      [{ target_sets: 4, rest_seconds: null }],
    ])).toBe(7);
  });

  it("is 0 for a routine with no days, and counts an empty day as 0 minutes", () => {
    expect(sessionMinutes([])).toBe(0);
    expect(sessionMinutes([[], [{ target_sets: 3, rest_seconds: 60 }]])).toBe(3); // (0 + 5) / 2 = 2.5 → 3
  });
});
