import { describe, expect, it } from "vitest";
import {
  BADGE_SLUGS,
  FITNESS_SCORE_MILESTONES,
  canSeeFitnessScore,
  canSeeStats,
  earnedBadges,
  fitnessScoreMilestone,
  fitnessScorePostPayload,
  followState,
  isBadgeSlug,
  isProfileVisibility,
  longestRun,
  newBadges,
  type BadgeFacts,
} from "./achievements";
import { payloadIsSafe, payloadMatchesType, validatePostEdit } from "./social";

const NONE: BadgeFacts = { workouts: 0, longestStreak: 0, prs: 0, checkins: 0, challengesCompleted: 0, longestFoodRun: 0 };

describe("earnedBadges — mirrors award_badges_for()", () => {
  it("earns nothing with no history", () => {
    expect(earnedBadges(NONE)).toEqual([]);
  });

  it("awards each threshold exactly at its boundary, not one before", () => {
    expect(earnedBadges({ ...NONE, workouts: 9 })).toEqual(["first-workout"]);
    expect(earnedBadges({ ...NONE, workouts: 10 })).toEqual(["first-workout", "workouts-10"]);
    expect(earnedBadges({ ...NONE, workouts: 100 })).toEqual(["first-workout", "workouts-10", "workouts-50", "workouts-100"]);
    expect(earnedBadges({ ...NONE, longestStreak: 6 })).toEqual([]);
    expect(earnedBadges({ ...NONE, longestStreak: 7 })).toEqual(["streak-7"]);
    expect(earnedBadges({ ...NONE, longestStreak: 100 })).toEqual(["streak-7", "streak-30", "streak-100"]);
    expect(earnedBadges({ ...NONE, prs: 10 })).toEqual(["first-pr", "prs-10"]);
    expect(earnedBadges({ ...NONE, checkins: 1 })).toEqual(["first-checkin"]);
    expect(earnedBadges({ ...NONE, challengesCompleted: 1 })).toEqual(["first-challenge"]);
    expect(earnedBadges({ ...NONE, longestFoodRun: 6 })).toEqual([]);
    expect(earnedBadges({ ...NONE, longestFoodRun: 7 })).toEqual(["nutrition-week"]);
  });

  it("only returns catalog slugs, in catalog order", () => {
    const all = earnedBadges({ workouts: 500, longestStreak: 500, prs: 500, checkins: 5, challengesCompleted: 5, longestFoodRun: 30 });
    expect(all).toEqual([...BADGE_SLUGS]);
    expect(all.every(isBadgeSlug)).toBe(true);
  });

  it("newBadges leaves out what is already held — the award is idempotent", () => {
    const facts = { ...NONE, workouts: 12 };
    expect(newBadges(facts, [])).toEqual(["first-workout", "workouts-10"]);
    expect(newBadges(facts, ["first-workout"])).toEqual(["workouts-10"]);
    expect(newBadges(facts, ["first-workout", "workouts-10"])).toEqual([]);
  });

  it("rejects non-catalog slugs", () => {
    expect(isBadgeSlug("admin")).toBe(false);
    expect(isBadgeSlug(42)).toBe(false);
  });
});

describe("longestRun — gaps and islands over days", () => {
  it("is 0 for nothing and 1 for a single day", () => {
    expect(longestRun([])).toBe(0);
    expect(longestRun(["2026-09-01"])).toBe(1);
  });

  it("counts consecutive days regardless of order and duplicates", () => {
    expect(longestRun(["2026-09-03", "2026-09-01", "2026-09-02", "2026-09-02"])).toBe(3);
  });

  it("breaks on a gap and keeps the longest island", () => {
    expect(longestRun(["2026-09-01", "2026-09-02", "2026-09-04", "2026-09-05", "2026-09-06"])).toBe(3);
  });

  it("crosses month and year boundaries", () => {
    expect(longestRun(["2026-12-30", "2026-12-31", "2027-01-01"])).toBe(3);
    expect(longestRun(["2028-02-28", "2028-02-29", "2028-03-01"])).toBe(3);
  });

  it("ignores malformed entries", () => {
    expect(longestRun(["nope", "2026-09-01", "2026-9-2", "2026-09-02"])).toBe(2);
  });
});

describe("Fitness Score milestones — mirrors social_posts_guard", () => {
  it("picks the highest milestone at or under the score", () => {
    expect(fitnessScoreMilestone(24)).toBeNull();
    expect(fitnessScoreMilestone(25)).toBe(25);
    expect(fitnessScoreMilestone(59)).toBe(50);
    expect(fitnessScoreMilestone(70)).toBe(70);
    expect(fitnessScoreMilestone(100)).toBe(100);
    expect(fitnessScoreMilestone(Number.NaN)).toBeNull();
  });

  it("builds a payload of three facts only, clamped and rounded", () => {
    expect(fitnessScorePostPayload(72.6, "strong_activity")).toEqual({ kind: "fitness_score", score: 73, milestone: 70, band: "strong_activity" });
    expect(fitnessScorePostPayload(150)).toEqual({ kind: "fitness_score", score: 100, milestone: 100, band: null });
    expect(fitnessScorePostPayload(10)).toBeNull();
    expect(fitnessScorePostPayload(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("never lets the milestone exceed the score", () => {
    for (let s = 0; s <= 100; s++) {
      const p = fitnessScorePostPayload(s);
      if (p) {
        expect(p.milestone).toBeLessThanOrEqual(p.score);
        expect(FITNESS_SCORE_MILESTONES).toContain(p.milestone);
      }
    }
  });

  it("a fitness score payload passes the private-key guard and matches its type", () => {
    const p = fitnessScorePostPayload(80)!;
    expect(payloadIsSafe(p)).toBe(true);
    expect(payloadMatchesType("fitness_score", p)).toBe(true);
    expect(payloadMatchesType("pr", p)).toBe(false);
  });
});

describe("payloadMatchesType", () => {
  it("a text post carries no payload", () => {
    expect(payloadMatchesType("text", null)).toBe(true);
    expect(payloadMatchesType("text", { kind: "achievement", badge_slug: "first-pr" })).toBe(false);
  });
  it("an achievement post carries an achievement payload", () => {
    expect(payloadMatchesType("achievement", { kind: "achievement", badge_slug: "first-pr" })).toBe(true);
  });
});

describe("profile privacy — mirrors can_see_stats() / can_see_fitness_score()", () => {
  const me = "me";
  const pub = { id: "u", stats_visibility: "public" as const, fitness_score_visibility: "public" as const };
  const fol = { id: "u", stats_visibility: "followers" as const, fitness_score_visibility: "followers" as const };
  const priv = { id: "u", stats_visibility: "private" as const, fitness_score_visibility: "private" as const };

  it("public is public", () => {
    expect(canSeeStats(pub, me, { follows: false })).toBe(true);
    expect(canSeeFitnessScore(pub, me, { follows: false })).toBe(true);
  });

  it("followers-only needs the follow edge", () => {
    expect(canSeeStats(fol, me, { follows: false })).toBe(false);
    expect(canSeeStats(fol, me, { follows: true })).toBe(true);
    expect(canSeeFitnessScore(fol, me, { follows: false })).toBe(false);
    expect(canSeeFitnessScore(fol, me, { follows: true })).toBe(true);
  });

  it("private is the owner alone — following changes nothing", () => {
    expect(canSeeStats(priv, me, { follows: true })).toBe(false);
    expect(canSeeFitnessScore(priv, me, { follows: true })).toBe(false);
    expect(canSeeStats({ ...priv, id: me }, me, { follows: false })).toBe(true);
    expect(canSeeFitnessScore({ ...priv, id: me }, me, { follows: false })).toBe(true);
  });

  it("a coach or admin sees stats, but the published score stays opt-in", () => {
    expect(canSeeStats(priv, me, { follows: false, coach: true })).toBe(true);
    expect(canSeeStats(priv, me, { follows: false, admin: true })).toBe(true);
    expect(canSeeFitnessScore(priv, me, { follows: false })).toBe(false);
  });

  it("validates visibility strings", () => {
    expect(isProfileVisibility("followers")).toBe(true);
    expect(isProfileVisibility("friends")).toBe(false);
    expect(isProfileVisibility(null)).toBe(false);
  });
});

describe("followState", () => {
  it("names each relationship", () => {
    expect(followState({ me: true, is_following: false, follows_me: false })).toBe("self");
    expect(followState({ me: false, is_following: true, follows_me: true })).toBe("mutual");
    expect(followState({ me: false, is_following: true, follows_me: false })).toBe("following");
    expect(followState({ me: false, is_following: false, follows_me: true })).toBe("follows_you");
    expect(followState({ me: false, is_following: false, follows_me: false })).toBe("none");
  });
});


describe("validatePostEdit — the caption rule behind editPost()", () => {
  it("a text post keeps 1–500 characters", () => {
    expect(validatePostEdit("text", "  new words  ")).toEqual({ ok: true, text: "new words" });
    expect(validatePostEdit("text", "   ")).toEqual({ ok: false });
    expect(validatePostEdit("text", "x".repeat(501))).toEqual({ ok: false });
  });
  it("a data post may clear its caption, but not overflow it", () => {
    expect(validatePostEdit("workout", "")).toEqual({ ok: true, text: null });
    expect(validatePostEdit("fitness_score", "  ")).toEqual({ ok: true, text: null });
    expect(validatePostEdit("achievement", "Finally!")).toEqual({ ok: true, text: "Finally!" });
    expect(validatePostEdit("pr", "x".repeat(501))).toEqual({ ok: false });
  });
  it("control characters are dropped, markup is kept as text", () => {
    expect(validatePostEdit("text", "a\u0000b <b>c</b>")).toEqual({ ok: true, text: "ab <b>c</b>" });
  });
});
