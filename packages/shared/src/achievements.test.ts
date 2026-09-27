import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATEGORIES,
  BADGE_SLUGS,
  achievementDef,
  achievementProgress,
  categoriesPresent,
  isAchievementCategory,
  isAchievementMetric,
  isAchievementRarity,
  isEligible,
  metricUnit,
  strengthFacts,
  summarizeAchievements,
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
    const all = earnedBadges({
      workouts: 5000, longest_streak: 500, prs: 500, checkins: 5, challenges: 50, longest_food_run: 30,
      volume_kg: 5e6, active_days: 1000, nutrition_days: 1000, bench_kg: 200, squat_kg: 300, deadlift_kg: 300,
      e1rm_total_kg: 1200,
    });
    expect(all).toEqual([...BADGE_SLUGS]);
    expect(all.every(isBadgeSlug)).toBe(true);
  });

  it("the original twelve still come from the original six counts", () => {
    const all = earnedBadges({ workouts: 500, longestStreak: 500, prs: 500, checkins: 5, challengesCompleted: 5, longestFoodRun: 30 });
    expect(all).not.toContain("bench-100");
    expect(all).not.toContain("volume-100k");
    expect(all).toContain("workouts-500");
    expect(all).toContain("challenges-5");
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

// ---------- advanced achievements (20261002100000) ----------

describe("ACHIEVEMENT_CATALOG — mirrors the badges rows", () => {
  it("has 34 unique slugs, every one with a known metric, category and rarity", () => {
    expect(ACHIEVEMENT_CATALOG).toHaveLength(34);
    expect(new Set(BADGE_SLUGS).size).toBe(34);
    for (const d of ACHIEVEMENT_CATALOG) {
      expect(isAchievementMetric(d.metric)).toBe(true);
      expect(isAchievementCategory(d.category)).toBe(true);
      expect(isAchievementRarity(d.rarity)).toBe(true);
      expect(d.target).toBeGreaterThan(0);
    }
  });

  it("pins the same targets advanced_achievements.test.sql pins on the SQL side", () => {
    const rule = (slug: string) => {
      const d = achievementDef(slug)!;
      return `${d.metric}:${d.target}`;
    };
    expect(rule("bench-100")).toBe("bench_kg:100");
    expect(rule("squat-140")).toBe("squat_kg:140");
    expect(rule("deadlift-180")).toBe("deadlift_kg:180");
    expect(rule("e1rm-total-1000")).toBe("e1rm_total_kg:1000");
    expect(rule("volume-1m")).toBe("volume_kg:1000000");
    expect(rule("active-days-365")).toBe("active_days:365");
    expect(rule("nutrition-days-100")).toBe("nutrition_days:100");
    expect(rule("challenges-25")).toBe("challenges:25");
    expect(rule("workouts-1000")).toBe("workouts:1000");
    expect(rule("prs-100")).toBe("prs:100");
    expect(rule("nutrition-week")).toBe("longest_food_run:7");
    expect(rule("streak-7")).toBe("longest_streak:7");
  });

  it("keeps the original twelve as standard and marks the rest advanced", () => {
    expect(ACHIEVEMENT_CATALOG.filter((d) => d.kind === "standard")).toHaveLength(12);
    expect(achievementDef("workouts-100")!.kind).toBe("standard");
    expect(achievementDef("workouts-250")!.kind).toBe("advanced");
    expect(achievementDef("nope")).toBeNull();
  });

  it("gives every metric a unit", () => {
    expect(metricUnit("workouts")).toBe("workouts");
    expect(metricUnit("volume_kg")).toBe("kg");
    expect(metricUnit("bench_kg")).toBe("kg");
    expect(metricUnit("active_days")).toBe("days");
    expect(metricUnit("checkins")).toBe("check_ins");
  });
});

describe("isEligible / earnedBadges — milestone thresholds", () => {
  it("workouts: 100, 250, 500, 1000", () => {
    expect(earnedBadges({ workouts: 249 })).toEqual(["first-workout", "workouts-10", "workouts-50", "workouts-100"]);
    expect(earnedBadges({ workouts: 250 })).toContain("workouts-250");
    expect(earnedBadges({ workouts: 999 })).not.toContain("workouts-1000");
    expect(earnedBadges({ workouts: 1000 })).toContain("workouts-1000");
  });

  it("volume: 100k, 500k, 1M kg — exact, no rounding up", () => {
    expect(earnedBadges({ volume_kg: 99_999.99 })).toEqual([]);
    expect(earnedBadges({ volume_kg: 100_000 })).toEqual(["volume-100k"]);
    expect(earnedBadges({ volume_kg: 742_500 })).toEqual(["volume-100k", "volume-500k"]);
    expect(earnedBadges({ volume_kg: 1_000_000 })).toEqual(["volume-100k", "volume-500k", "volume-1m"]);
  });

  it("consistency: active days 30 / 90 / 180 / 365", () => {
    expect(earnedBadges({ active_days: 29 })).toEqual([]);
    expect(earnedBadges({ active_days: 180 })).toEqual(["active-days-30", "active-days-90", "active-days-180"]);
    expect(earnedBadges({ active_days: 365 })).toContain("active-days-365");
  });

  it("PRs: 10 / 25 / 50 / 100", () => {
    expect(earnedBadges({ prs: 38 })).toEqual(["first-pr", "prs-10", "prs-25"]);
    expect(earnedBadges({ prs: 100 })).toEqual(["first-pr", "prs-10", "prs-25", "prs-50", "prs-100"]);
  });

  it("nutrition: logged days 30 / 100 are separate from the 7-day run", () => {
    expect(earnedBadges({ nutrition_days: 100 })).toEqual(["nutrition-days-30", "nutrition-days-100"]);
    expect(earnedBadges({ longest_food_run: 7 })).toEqual(["nutrition-week"]);
  });

  it("challenges: first, 5, 10, 25", () => {
    expect(earnedBadges({ challenges: 1 })).toEqual(["first-challenge"]);
    expect(earnedBadges({ challenges: 10 })).toEqual(["first-challenge", "challenges-5", "challenges-10"]);
    expect(earnedBadges({ challenges: 25 })).toContain("challenges-25");
  });

  it("strength: one event can reach several milestones at once", () => {
    expect(earnedBadges({ bench_kg: 100, squat_kg: 140, deadlift_kg: 180, e1rm_total_kg: 1000 })).toEqual([
      "bench-100", "squat-140", "deadlift-180", "e1rm-total-1000",
    ]);
  });

  it("insufficient data: missing or non-finite facts earn nothing", () => {
    expect(earnedBadges({})).toEqual([]);
    expect(earnedBadges({ bench_kg: Number.NaN, volume_kg: Number.NaN })).toEqual([]);
    expect(isEligible({ metric: "workouts", target: 1 }, { workouts: 5 }, false)).toBe(false);
  });

  it("duplicate awarding: a held badge is never new again", () => {
    const facts = { bench_kg: 120, squat_kg: 150 };
    const first = newBadges(facts, []);
    expect(first).toEqual(["bench-100", "squat-140"]);
    expect(newBadges(facts, first)).toEqual([]);
  });
});

describe("achievementProgress — current / target / percent / remaining", () => {
  it("73 / 100 workouts", () => {
    expect(achievementProgress(73, 100)).toEqual({ current: 73, target: 100, percent: 73, remaining: 27, complete: false });
  });

  it("742,500 / 1,000,000 kg", () => {
    const p = achievementProgress(742_500, 1_000_000);
    expect(p.percent).toBe(74);
    expect(p.remaining).toBe(257_500);
  });

  it("never shows 100% before it is earned", () => {
    expect(achievementProgress(99.6, 100).percent).toBe(99);
    expect(achievementProgress(999_999, 1_000_000).percent).toBe(99);
  });

  it("caps at 100 and 0 remaining once met", () => {
    expect(achievementProgress(150, 100)).toEqual({ current: 150, target: 100, percent: 100, remaining: 0, complete: true });
  });

  it("treats junk input as zero and a bad target as met", () => {
    expect(achievementProgress(Number.NaN, 10)).toMatchObject({ current: 0, percent: 0, remaining: 10 });
    expect(achievementProgress(-5, 10)).toMatchObject({ current: 0, percent: 0 });
    expect(achievementProgress(3, 0)).toMatchObject({ complete: true, percent: 100 });
  });
});

describe("strengthFacts — mirrors achievement_facts() for the lifts", () => {
  it("counts weight lifted, not the estimate, for the lift milestones", () => {
    const f = strengthFacts([{ lift: "bench", weight_kg: 97.5, reps: 3, completed: true }]);
    expect(f.bench_kg).toBe(97.5);
    expect(f.e1rm_total_kg).toBe(107.25);
    expect(earnedBadges(f)).not.toContain("bench-100");
  });

  it("sums each lift's best estimate for the total", () => {
    const f = strengthFacts([
      { lift: "bench", weight_kg: 97.5, reps: 3, completed: true },
      { lift: "bench", weight_kg: 100, reps: 1, completed: true },
      { lift: "squat", weight_kg: 400, reps: 1, completed: true },
      { lift: "deadlift", weight_kg: 500, reps: 1, completed: true },
    ]);
    expect(f).toEqual({ bench_kg: 100, squat_kg: 400, deadlift_kg: 500, e1rm_total_kg: 1007.25 });
    expect(earnedBadges(f)).toEqual(["bench-100", "squat-140", "deadlift-180", "e1rm-total-1000"]);
  });

  it("ignores unfinished sessions, zero reps and empty bars", () => {
    const f = strengthFacts([
      { lift: "deadlift", weight_kg: 250, reps: 1, completed: false },
      { lift: "deadlift", weight_kg: 250, reps: 0, completed: true },
      { lift: "squat", weight_kg: 0, reps: 5, completed: true },
    ]);
    expect(f).toEqual({ bench_kg: 0, squat_kg: 0, deadlift_kg: 0, e1rm_total_kg: 0 });
  });

  it("a set above 12 reps moves the top weight but not the estimate", () => {
    const f = strengthFacts([{ lift: "squat", weight_kg: 100, reps: 20, completed: true }]);
    expect(f.squat_kg).toBe(100);
    expect(f.e1rm_total_kg).toBe(0);
  });
});

describe("categoriesPresent / summarizeAchievements", () => {
  it("offers only categories some badge uses, in display order", () => {
    expect(categoriesPresent([{ category: "volume" }, { category: "strength" }])).toEqual(["strength", "volume"]);
    expect(categoriesPresent(ACHIEVEMENT_CATALOG)).toEqual([...ACHIEVEMENT_CATEGORIES]);
    expect(categoriesPresent([{ category: "social" }])).toEqual([]);
  });

  it("counts earned per category and per rarity", () => {
    const s = summarizeAchievements([
      { category: "strength", rarity: "epic", earned: true },
      { category: "strength", rarity: "common", earned: false },
      { category: "workouts", rarity: "common", earned: true },
    ]);
    expect(s.earned).toBe(2);
    expect(s.total).toBe(3);
    expect(s.byCategory).toEqual([
      { category: "strength", earned: 1, total: 2 },
      { category: "workouts", earned: 1, total: 1 },
    ]);
    expect(s.byRarity).toEqual([{ rarity: "common", earned: 1 }, { rarity: "epic", earned: 1 }]);
  });
});
