import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_METRICS } from "@healthapp/shared";
import { commonMessages } from "./i18n/messages/common";
import { metricExplanation, progressText, requirementText } from "./achievement-format";

const en = commonMessages.en.achievements;
const ro = commonMessages.ro.achievements;

describe("requirementText", () => {
  it("reads the metric and target, localised", () => {
    expect(requirementText(en, "workouts", 100, "en")).toBe("Complete 100 workouts.");
    expect(requirementText(en, "volume_kg", 1_000_000, "en")).toBe("Lift 1,000,000 kg in total.");
    expect(requirementText(ro, "bench_kg", 100, "ro")).toBe("Împins la piept cu 100 kg, cel puțin o repetare.");
  });

  it("uses the 'first' wording for a target of one", () => {
    expect(requirementText(en, "workouts", 1, "en")).toBe("Complete your first workout.");
    expect(requirementText(ro, "challenges", 1, "ro")).toBe("Finalizează prima provocare.");
  });

  it("says nothing for a metric the app does not know", () => {
    expect(requirementText(en, "followers", 10, "en")).toBe("");
    expect(metricExplanation(en, "followers")).toBe("");
  });

  it("has a requirement and an explanation for every metric, in both languages", () => {
    for (const m of ACHIEVEMENT_METRICS) {
      expect(requirementText(en, m, 5, "en")).not.toBe("");
      expect(requirementText(ro, m, 5, "ro")).not.toBe("");
      expect(metricExplanation(en, m)).not.toBe("");
      expect(metricExplanation(ro, m)).not.toBe("");
    }
  });

  it("keeps weight lifted and the estimate apart in the explanation", () => {
    expect(metricExplanation(en, "bench_kg")).toMatch(/not an estimate/);
    expect(metricExplanation(en, "e1rm_total_kg")).toMatch(/not weight lifted/);
  });
});

describe("progressText", () => {
  it("73 / 100 workouts, 27 to go", () => {
    const p = progressText(en, "workouts", 73, 100, "en");
    expect(p.line).toBe("73 / 100 workouts");
    expect(p.percent).toBe(73);
    expect(p.remainingLine).toBe("27 workouts to go");
  });

  it("formats large kg values for the locale", () => {
    expect(progressText(en, "volume_kg", 742_500, 1_000_000, "en").line).toBe("742,500 / 1,000,000 kg");
    expect(progressText(ro, "volume_kg", 742_500, 1_000_000, "ro").line).toBe("742.500 / 1.000.000 kg");
  });

  it("has no remaining line once complete", () => {
    expect(progressText(en, "prs", 50, 50, "en").remainingLine).toBeNull();
  });
});
