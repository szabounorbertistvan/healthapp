import { describe, expect, test } from "vitest";
import { trainingLoad, workoutPostPayload } from "@healthapp/shared";
import {
  DEFAULT_SHARE_OPTIONS,
  SHARE_FORMAT_SIZE,
  SHARE_MAX_PR_LINES,
  SHARE_STAT_KEYS,
  durationLabel,
  layoutShareCard,
  layoutText,
  shareCardFromHistory,
  shareCardFromSession,
  shareDateLabel,
  type ShareCardLabels,
  type ShareCardOptions,
  type ShareCardLayout,
  type ShareTextItem,
  type WorkoutShareCard,
} from "./share-card";
import type { ShareableSession, WorkoutHistorySession } from "./types";

// The card is built from the feed's snapshot (workoutPostPayload) and laid
// out deterministically. These tests pin: the numbers on it are the ones the
// app already computed, sensitive data cannot get on, absent stats leave no
// hole or "0", the client's choices only hide things, and nothing overflows
// or overlaps at either size.

const EN: ShareCardLabels = {
  workoutComplete: "Workout Complete",
  duration: "Duration",
  exercises: "Exercises",
  sets: "Sets",
  volume: "Volume",
  volumeUnit: "kg",
  trainingLoad: "Training Load",
  loadCategory: { very_light: "Very Light", light: "Light", moderate: "Moderate", hard: "Hard", very_hard: "Very Hard" },
  newPr: "New PR",
  prsCount: "{count} PRs",
  morePrs: "+{count} more",
  brand: "Voinic",
};

const RO: ShareCardLabels = {
  ...EN,
  workoutComplete: "Antrenament finalizat",
  duration: "Durată",
  exercises: "Exerciții",
  sets: "Serii",
  volume: "Volum",
  newPr: "Record nou",
  prsCount: "{count} recorduri",
  loadCategory: { very_light: "Foarte ușor", light: "Ușor", moderate: "Moderat", hard: "Greu", very_hard: "Foarte greu" },
};

const profile = { name: "norbert", username: "norbert", avatar_url: null };

/** A finished leg day as the done page receives it from getShareableSession. */
const session: ShareableSession = {
  session_id: "s-1",
  name: "Leg day",
  date: "2026-09-15",
  duration_min: 72,
  exercises: 8,
  sets: 24,
  volume_kg: 8420,
  load: 78,
  prs: [
    { set_id: "a", exercise: "Squat", weight_kg: 140, reps: 5, estimated_1rm: 163.3, shared: false },
    { set_id: "b", exercise: "Leg press", weight_kg: 220, reps: 10, estimated_1rm: 293.3, shared: false },
  ],
  already_shared: false,
};

function texts(layout: ShareCardLayout): ShareTextItem[] {
  return layout.items.filter((i): i is ShareTextItem => i.kind === "text");
}

function layoutOf(card: WorkoutShareCard, patch: Partial<ShareCardOptions> = {}, locale = "en", labels = EN) {
  return layoutShareCard({ card, options: { ...DEFAULT_SHARE_OPTIONS, ...patch }, locale, labels });
}

/** Every item inside the image, and no two text lines in the same column crossing. */
function expectClean(layout: ShareCardLayout) {
  for (const item of layout.items) {
    if (item.kind === "text") {
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.y + item.size).toBeLessThanOrEqual(layout.height);
      expect(item.maxWidth).toBeGreaterThan(0);
      expect(item.size, `${item.id} too small to read`).toBeGreaterThanOrEqual(18);
    } else if (item.kind === "rect" || item.kind === "bar") {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.x + item.w).toBeLessThanOrEqual(layout.width);
      expect(item.y + item.h).toBeLessThanOrEqual(layout.height);
    }
  }
  const lines = texts(layout);
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]!;
      const b = lines[j]!;
      const sameColumn = Math.abs(a.x - b.x) < 1 && a.align === b.align;
      const pairedRow = a.id.replace(/-value$/, "") === b.id.replace(/-value$/, ""); // "pr-0" and its value share a row on purpose
      if (!sameColumn || pairedRow) continue;
      const overlap = a.y < b.y + b.size && b.y < a.y + a.size;
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
}

describe("shareCardFromSession", () => {
  test("carries exactly the feed's snapshot of the session — same name, duration, counts, volume and load", () => {
    const card = shareCardFromSession(session, profile);
    expect(card.session_id).toBe("s-1");
    expect(card.workout).toEqual(workoutPostPayload({ ...session, prs: 2 }));
    expect(card.workout.duration_min).toBe(72);
    expect(card.workout.exercises).toBe(8);
    expect(card.workout.sets).toBe(24);
    expect(card.workout.volume_kg).toBe(8420);
    expect(card.workout.load).toBe(78);
    expect(card.workout.prs).toBe(2);
  });

  test("lists the PRs heaviest first, without set ids or 1RM estimates", () => {
    const card = shareCardFromSession(session, profile);
    expect(card.prs).toEqual([
      { exercise: "Leg press", weight_kg: 220, reps: 10 },
      { exercise: "Squat", weight_kg: 140, reps: 5 },
    ]);
  });

  test("never carries body weight, body fat, measurements, food or calories", () => {
    const card = shareCardFromSession(session, profile);
    const keys = JSON.stringify(card).toLowerCase();
    for (const banned of ["body_weight", "body_fat", "kcal", "calories", "protein", "waist", "measurement", "notes", "coach"]) {
      expect(keys).not.toContain(banned);
    }
    expect(SHARE_STAT_KEYS).not.toContain("calories");
    expect(Object.keys(DEFAULT_SHARE_OPTIONS.stats)).toEqual([...SHARE_STAT_KEYS]);
  });

  test("keeps the profile the app shows — username, never an email", () => {
    const card = shareCardFromSession(session, { name: "norbert", username: "norbert", avatar_url: "https://x/a.png" });
    expect(card.profile).toEqual({ name: "norbert", username: "norbert", avatar_url: "https://x/a.png" });
    expect(shareCardFromSession(session, null).profile).toBeNull();
  });
});

describe("shareCardFromHistory", () => {
  const history: WorkoutHistorySession = {
    id: "s-9",
    at: "2026-09-01T18:20:00.000Z",
    sets: 3,
    volume_kg: 2100,
    prs: 1,
    load: trainingLoad({
      sets: [
        { weight_kg: 100, reps: 8, rpe: 8, rir: null },
        { weight_kg: 100, reps: 8, rpe: 8, rir: null },
        { weight_kg: 50, reps: 10, rpe: 7, rir: null },
      ],
      duration_min: 45,
      exercise_count: 2,
    }),
    exercises: [
      {
        name: "Bench press",
        sets: [
          { id: "x1", set_index: 1, weight_kg: 100, reps: 8, rpe: 8, rir: null, notes: "felt heavy", is_pr: true },
          { id: "x2", set_index: 2, weight_kg: 100, reps: 8, rpe: 8, rir: null, notes: null, is_pr: false },
        ],
      },
      { name: "Fly", sets: [{ id: "x3", set_index: 1, weight_kg: 50, reps: 10, rpe: 7, rir: null, notes: null, is_pr: false }] },
    ],
  };

  test("builds a historical session's card from its own rows and the day's name — the given id, not the latest", () => {
    const card = shareCardFromHistory(history, "Push A", profile);
    expect(card.session_id).toBe("s-9");
    expect(card.workout.name).toBe("Push A");
    expect(card.workout.date).toBe("2026-09-01");
    expect(card.workout.duration_min).toBe(45);
    expect(card.workout.exercises).toBe(2);
    expect(card.workout.sets).toBe(3);
    expect(card.workout.volume_kg).toBe(2100);
    expect(card.workout.load).toBe(history.load.score);
    expect(card.prs).toEqual([{ exercise: "Bench press", weight_kg: 100, reps: 8 }]);
  });

  test("leaves the per-set notes behind", () => {
    expect(JSON.stringify(shareCardFromHistory(history, "Push A", profile))).not.toContain("felt heavy");
  });
});

describe("layoutShareCard — formats", () => {
  const card = shareCardFromSession(session, profile);

  test("Story is 1080 × 1920", () => {
    const l = layoutOf(card, { format: "story" });
    expect([l.width, l.height]).toEqual([1080, 1920]);
    expect(SHARE_FORMAT_SIZE.story).toEqual({ width: 1080, height: 1920 });
    expectClean(l);
  });

  test("Square is 1080 × 1080", () => {
    const l = layoutOf(card, { format: "square" });
    expect([l.width, l.height]).toEqual([1080, 1080]);
    expect(SHARE_FORMAT_SIZE.square).toEqual({ width: 1080, height: 1080 });
    expectClean(l);
  });

  test("Story is the default", () => {
    expect(DEFAULT_SHARE_OPTIONS.format).toBe("story");
  });
});

describe("layoutShareCard — content", () => {
  const card = shareCardFromSession(session, profile);
  const l = layoutOf(card);

  test("shows the workout name, date and the completed kicker", () => {
    expect(layoutText(l, "kicker")).toBe("WORKOUT COMPLETE");
    expect(layoutText(l, "name")).toBe("LEG DAY");
    expect(layoutText(l, "date")).toBe("15 SEP 2026");
  });

  test("shows the real duration in the feed's format", () => {
    expect(layoutText(l, "duration")).toBe("1h 12m");
    expect(durationLabel(45)).toBe("45 min");
    expect(durationLabel(120)).toBe("2h 0m");
    expect(durationLabel(null)).toBeNull();
  });

  test("shows the logged exercise and set counts", () => {
    expect(layoutText(l, "exercises")).toBe("8");
    expect(layoutText(l, "exercises-label")).toBe("EXERCISES");
    expect(layoutText(l, "sets")).toBe("24");
    expect(layoutText(l, "sets-label")).toBe("SETS");
  });

  test("shows the volume in kg, locale-formatted", () => {
    expect(layoutText(l, "volume")).toBe("8,420");
    expect(layoutText(l, "volume-label")).toBe("KG VOLUME");
    expect(layoutText(layoutOf(card, {}, "ro", RO), "volume")).toBe("8.420");
  });

  test("shows the Training Load score and its category, with a meter", () => {
    expect(layoutText(l, "load-label")).toBe("TRAINING LOAD");
    expect(layoutText(l, "load")).toBe("78");
    expect(layoutText(l, "load-category")).toBe("HARD");
    const bar = l.items.find((i) => i.id === "load-bar");
    expect(bar?.kind).toBe("bar");
    expect(bar && bar.kind === "bar" ? bar.value : null).toBeCloseTo(0.78);
  });

  test("lists the PRs when there are any", () => {
    expect(layoutText(l, "pr-head")).toBe("🏆 2 PRS");
    expect(layoutText(l, "pr-0")).toBe("Leg press");
    expect(layoutText(l, "pr-0-value")).toBe("220 kg × 10");
    expect(layoutText(l, "pr-1")).toBe("Squat");
    expect(layoutText(l, "pr-1-value")).toBe("140 kg × 5");
    expect(layoutText(l, "pr-more")).toBeNull();
  });

  test("a single PR is headed 'New PR'", () => {
    const one = shareCardFromSession({ ...session, prs: session.prs.slice(0, 1) }, profile);
    expect(layoutText(layoutOf(one), "pr-head")).toBe("🏆 NEW PR");
  });

  test("caps the PR lines and folds the rest into '+N more'", () => {
    const many = shareCardFromSession(
      { ...session, prs: Array.from({ length: 6 }, (_, i) => ({ set_id: `p${i}`, exercise: `Lift ${i}`, weight_kg: 100 - i, reps: 5, estimated_1rm: 0, shared: false })) },
      profile,
    );
    const ml = layoutOf(many);
    expect(layoutText(ml, "pr-head")).toBe("🏆 6 PRS");
    expect(layoutText(ml, `pr-${SHARE_MAX_PR_LINES - 1}`)).not.toBeNull();
    expect(layoutText(ml, `pr-${SHARE_MAX_PR_LINES}`)).toBeNull();
    expect(layoutText(ml, "pr-more")).toBe("+3 more");
    expectClean(ml);
    expectClean(layoutOf(many, { format: "square" }));
  });

  test("hides the PR block entirely when the session set none", () => {
    const none = shareCardFromSession({ ...session, prs: [] }, profile);
    const nl = layoutOf(none);
    expect(nl.items.some((i) => /^pr-/.test(i.id))).toBe(false);
    expectClean(nl);
  });

  test("shows no duration when the session was not timed — never a 0", () => {
    const untimed = shareCardFromSession({ ...session, duration_min: null }, profile);
    const ul = layoutOf(untimed);
    expect(layoutText(ul, "duration")).toBeNull();
    expect(texts(ul).some((x) => x.text === "0")).toBe(false);
  });

  test("shows the profile by default and hides it on request", () => {
    expect(layoutText(l, "profile-name")).toBe("norbert");
    expect(layoutText(l, "profile-username")).toBe("@norbert");
    expect(l.items.some((i) => i.kind === "avatar")).toBe(true);
    const hidden = layoutOf(card, { showProfile: false });
    expect(texts(hidden).some((x) => x.id.startsWith("profile"))).toBe(false);
    expect(hidden.items.some((i) => i.kind === "avatar")).toBe(false);
    expect(hidden.items.some((i) => i.kind === "brand")).toBe(true);
    expect(DEFAULT_SHARE_OPTIONS.showProfile).toBe(true);
  });

  test("carries the brand quietly in the footer, once", () => {
    const brands = l.items.filter((i) => i.kind === "brand");
    expect(brands).toHaveLength(1);
    expect(brands[0]!.kind === "brand" && brands[0]!.text).toBe("Voinic");
    expect(brands[0]!.y).toBeGreaterThan(l.height * 0.85);
  });
});

describe("layoutShareCard — the client's choices only hide", () => {
  const card = shareCardFromSession(session, profile);

  test.each(SHARE_STAT_KEYS)("turning %s off removes it and nothing else", (key) => {
    const l = layoutOf(card, { stats: { ...DEFAULT_SHARE_OPTIONS.stats, [key]: false } });
    const ids = texts(l).map((x) => x.id);
    const own = key === "prs" ? "pr-head" : key;
    expect(ids).not.toContain(own);
    for (const other of SHARE_STAT_KEYS) {
      if (other === key) continue;
      expect(ids).toContain(other === "prs" ? "pr-head" : other);
    }
    expectClean(l);
  });

  test("every stat can be off at once and the card still stands", () => {
    const l = layoutOf(card, { stats: { duration: false, exercises: false, sets: false, volume: false, load: false, prs: false } });
    expect(layoutText(l, "name")).toBe("LEG DAY");
    expect(texts(l).map((x) => x.id)).toEqual(["kicker", "name", "date", "profile-name", "profile-username"]);
    expectClean(l);
  });

  test("the numbers cannot be changed through the options", () => {
    const l = layoutOf(card, { stats: { ...DEFAULT_SHARE_OPTIONS.stats, volume: true } });
    expect(layoutText(l, "volume")).toBe("8,420");
    expect(layoutText(l, "load")).toBe("78");
  });
});

describe("layoutShareCard — languages", () => {
  const card = shareCardFromSession(session, profile);

  test("English", () => {
    const l = layoutOf(card, {}, "en", EN);
    expect(layoutText(l, "kicker")).toBe("WORKOUT COMPLETE");
    expect(layoutText(l, "duration-label")).toBe("DURATION");
    expect(layoutText(l, "sets-label")).toBe("SETS");
  });

  test("Romanian", () => {
    const l = layoutOf(card, {}, "ro", RO);
    expect(layoutText(l, "kicker")).toBe("ANTRENAMENT FINALIZAT");
    expect(layoutText(l, "duration-label")).toBe("DURATĂ");
    expect(layoutText(l, "sets-label")).toBe("SERII");
    expect(layoutText(l, "exercises-label")).toBe("EXERCIȚII");
    expect(layoutText(l, "pr-head")).toBe("🏆 2 RECORDURI");
    expect(layoutText(l, "date")).toBe("15 SEP 2026");
    expectClean(l);
  });

  test("date label reads the yyyy-mm-dd day as a local day", () => {
    expect(shareDateLabel("2026-01-03", "en")).toBe("3 JAN 2026");
  });
});
