import { describe, expect, it } from "vitest";
import { canShareExternally, prShareOneRm, sharePayloadFromPost, type ShareLabels } from "./share-payload";
import type { PostPayload } from "@healthapp/shared";

const LABELS: ShareLabels = {
  duration: "Duration", volume: "Volume", sets: "Sets", exercises: "Exercises",
  load: "Load", prs: "PRs", reps: "Reps", oneRm: "Est. 1RM", days: "Days",
  target: "Target", programDays: "Days", programExercises: "Exercises",
};

const FORMAT = {
  n: (v: number) => String(v),
  duration: (min: number | null) => (min === null ? null : `${min}m`),
};

function post(payload: PostPayload, over: { type?: string; visibility?: string } = {}) {
  return {
    type: over.type ?? payload?.kind ?? "text",
    payload,
    created_at: "2026-09-24T10:00:00Z",
    visibility: over.visibility ?? "public",
  };
}

const WORKOUT: PostPayload = {
  kind: "workout", name: "Push Day", date: "2026-09-24", duration_min: 64,
  exercises: 5, sets: 18, volume_kg: 8450, load: 72, prs: 1,
};

describe("sharePayloadFromPost", () => {
  it("builds a workout card from the snapshot", () => {
    const card = sharePayloadFromPost(post(WORKOUT), LABELS, FORMAT);
    expect(card).toMatchObject({ kind: "workout", title: "Push Day", headline: "8450 kg", date: "2026-09-24" });
    expect(card?.stats.map((s) => s.label)).toEqual(["Duration", "Sets", "Exercises", "Load", "PRs"]);
  });

  it("omits the PR row when the session had none — no empty sections", () => {
    const card = sharePayloadFromPost(post({ ...WORKOUT, prs: 0 }), LABELS, FORMAT);
    expect(card?.stats.map((s) => s.label)).not.toContain("PRs");
  });

  it("omits duration when it was never measured", () => {
    const card = sharePayloadFromPost(post({ ...WORKOUT, duration_min: null }), LABELS, FORMAT);
    expect(card?.stats.map((s) => s.label)).not.toContain("Duration");
  });

  it("builds a PR card", () => {
    const card = sharePayloadFromPost(post({
      kind: "pr", exercise: "Bench Press", weight_kg: 110, reps: 8, estimated_1rm: 139.3, date: "2026-09-20",
    }), LABELS, FORMAT);
    expect(card).toMatchObject({ kind: "pr", title: "Bench Press", headline: "110 kg × 8", date: "2026-09-20" });
    expect(card?.stats).toContainEqual({ label: "Est. 1RM", value: "139.3 kg" });
  });

  it("builds a streak card", () => {
    const card = sharePayloadFromPost(post({
      kind: "streak", streak_days: 32, milestone: 30, achieved_at: "2026-09-20",
      streak_start: "2026-08-21", title: "30 Day Streak",
    }), LABELS, FORMAT);
    expect(card).toMatchObject({ kind: "streak", title: "30 Day Streak", headline: "30" });
  });

  it("builds a challenge card", () => {
    const card = sharePayloadFromPost(post({
      kind: "challenge_completed", title_en: "October volume", title_ro: "Volum octombrie",
      type: "volume", target: 50000, value: 52100,
    }), LABELS, FORMAT);
    expect(card).toMatchObject({ kind: "challenge", title: "October volume", headline: "52100" });
  });

  it("builds a program card", () => {
    const card = sharePayloadFromPost(post({
      kind: "program", program_id: "p1", name: "Public PPL", description: null,
      days: 6, exercises: 24, level: "intermediate", goal: "hypertrophy",
      muscle_groups: ["chest"], est_minutes: 62,
    }), LABELS, FORMAT);
    expect(card).toMatchObject({ kind: "program", title: "Public PPL", headline: null });
    expect(card?.stats).toHaveLength(2);
  });

  it("refuses a progress post — that is the one payload that may carry a body weight", () => {
    expect(sharePayloadFromPost(post({
      kind: "progress", weight_kg: 78.4, photo_path: null,
    }), LABELS, FORMAT)).toBeNull();
  });

  it("refuses a text post and a post with no payload", () => {
    expect(sharePayloadFromPost(post(null), LABELS, FORMAT)).toBeNull();
  });

  it("never reads anything but the snapshot", () => {
    // The function takes the post and formatters only; there is no database
    // handle it could use to widen what a card shows.
    expect(sharePayloadFromPost.length).toBe(3);
  });
});

describe("canShareExternally", () => {
  it("allows the card-shaped public posts", () => {
    expect(canShareExternally({ visibility: "public", payload: WORKOUT })).toBe(true);
    expect(canShareExternally({ visibility: "followers", payload: WORKOUT })).toBe(true);
  });

  it("refuses a private post — leaving the app is a public act", () => {
    expect(canShareExternally({ visibility: "private", payload: WORKOUT })).toBe(false);
  });

  it("refuses text and progress posts", () => {
    expect(canShareExternally({ visibility: "public", payload: null })).toBe(false);
    expect(canShareExternally({
      visibility: "public",
      payload: { kind: "progress", weight_kg: 80, photo_path: null },
    })).toBe(false);
  });
});

describe("prShareOneRm", () => {
  it("is the exercise page's estimate (relevantOneRm), rounded to the one decimal a card shows", () => {
    // 72.5 × 5 → 84.583… → 84.6, the same figure /exercises and /progress show.
    expect(prShareOneRm(72.5, 5)).toBe(84.6);
  });

  it("takes a single rep at face value", () => {
    expect(prShareOneRm(140, 1)).toBe(140);
  });

  it("has no estimate past 12 reps — 0, which the card already leaves out", () => {
    // The old rule claimed 60 × 20 = 100 kg.
    expect(prShareOneRm(60, 20)).toBe(0);
  });

  it("has no estimate for a bodyweight set", () => {
    expect(prShareOneRm(0, 10)).toBe(0);
  });
});
